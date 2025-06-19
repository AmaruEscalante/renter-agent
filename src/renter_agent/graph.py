import json
import os

from typing_extensions import Literal

from langchain_core.messages import HumanMessage, SystemMessage, AIMessage
from langchain_core.runnables import RunnableConfig
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_openai import ChatOpenAI
from langgraph.graph import START, END, StateGraph
from langgraph.prebuilt import ToolNode

from renter_agent.configuration import Configuration, SearchAPI
from renter_agent.utils import (
    deduplicate_and_format_sources,
    tavily_search,
    format_sources,
    perplexity_search,
    duckduckgo_search,
    searxng_search,
    strip_thinking_tokens,
    get_config_value,
    create_google_maps_tools_sync,
)
from renter_agent.state import SummaryState, SummaryStateInput, SummaryStateOutput
from renter_agent.prompts import (
    query_refiner_instructions,
    summarizer_instructions,
    reflection_instructions,
    get_current_date,
)


# Nodes
def generate_query(state: SummaryState, config: RunnableConfig):
    """LangGraph node that handles conversation and generates search queries.

    Manages conversational flow with the user to gather apartment requirements,
    and only proceeds to search when sufficient information is collected.

    Args:
        state: Current graph state containing apartment requirements and chat history
        config: Configuration for the runnable, including LLM provider settings

    Returns:
        Dictionary with state update, including search_query, messages, and ready_to_search
    """

    print("=== GENERATE_QUERY FUNCTION CALLED ===")
    print(f"State apartment_requirements: {state.apartment_requirements}")
    print(f"State messages length: {len(state.messages) if state.messages else 0}")
    print(f"State ready_to_search: {state.ready_to_search}")
    print(f"Config: {config}")
    print("=======================================")

    # Add user message to chat history if we have apartment requirements
    print("Step 1: Creating chat messages...")
    new_messages = []

    # Only add user message if it's not already in chat history
    if state.apartment_requirements:
        # Check if this exact message is already in the chat history
        already_added = any(
            hasattr(msg, "content") and msg.content == state.apartment_requirements
            for msg in (state.messages or [])
        )

        if not already_added:
            new_messages.append(HumanMessage(content=state.apartment_requirements))

    # Format the prompt
    print("Step 2: Formatting prompt...")
    current_date = get_current_date()
    formatted_prompt = query_refiner_instructions.format(current_date=current_date)

    # Generate a query or follow-up question
    print("Step 3: Getting configuration...")
    configurable = Configuration.from_runnable_config(config)

    # Choose the appropriate LLM based on the provider
    print("Step 4: Setting up LLM...")
    if configurable.llm_provider == "gemini":
        llm_json_mode = ChatGoogleGenerativeAI(
            model="gemini-2.0-flash", temperature=0, api_key=os.getenv("GEMINI_API_KEY")
        )
    else:  # Default to OpenAI
        llm_json_mode = ChatOpenAI(
            model="gpt-4o-mini", temperature=0, api_key=os.getenv("OPENAI_API_KEY")
        )

    # Build conversation context for the LLM
    print("Step 5: Building chat context...")
    chat_context = ""
    if state.messages:
        chat_context = "\n".join(
            [
                f"{msg.__class__.__name__.replace('Message', '').lower()}: {msg.content}"
                for msg in state.messages
            ]
        )

    # Include current user input
    if state.apartment_requirements:
        chat_context += f"\nuser: {state.apartment_requirements}"

    print("Step 6: Calling LLM...")
    result = llm_json_mode.invoke(
        [
            SystemMessage(content=formatted_prompt),
            HumanMessage(
                content=chat_context if chat_context else state.apartment_requirements
            ),
        ]
    )
    print("Step 7: LLM call completed")

    # Get the content
    content = result.content

    print("LLM RESPONSE", content)
    print("LLM RESPONSE TYPE", type(content))
    print("LLM RESPONSE REPR", repr(content))

    # Parse the JSON response - handle markdown code blocks
    try:
        print("TRYING TO PARSE JSON...")
        # Strip markdown code blocks if present
        if content.startswith("```json"):
            content = content.split("```json")[1].split("```")[0].strip()
        elif content.startswith("```"):
            content = content.split("```")[1].split("```")[0].strip()

        query_response = json.loads(content)
        print("JSON PARSED SUCCESSFULLY:", query_response)
        search_query = query_response.get("query", "")
        follow_up_query = query_response.get("follow_up_query", "")
        begin_search = query_response.get("begin_search", False)

        if not begin_search:
            # Add assistant's follow-up question to chat history
            new_messages.append(AIMessage(content=follow_up_query))

            return {
                "messages": new_messages,
                "ready_to_search": False,
                "search_query": follow_up_query,  # This will be the follow-up question for the user
            }
        else:
            # We're ready to begin search
            new_messages.append(
                AIMessage(
                    content=f"Great! I'll now search for apartments based on your requirements: {search_query}"
                )
            )

            return {
                "messages": new_messages,
                "ready_to_search": True,
                "search_query": search_query,
            }

    except (json.JSONDecodeError, KeyError) as e:
        # If parsing fails, use fallback behavior
        print(f"JSON PARSING FAILED: {e}")
        print(f"CONTENT THAT FAILED TO PARSE: {repr(content)}")
        if configurable.strip_thinking_tokens:
            content = strip_thinking_tokens(content)

        # Treat the content as a follow-up question
        new_messages.append(AIMessage(content=content))

        return {
            "messages": new_messages,
            "ready_to_search": False,
            "search_query": content,
        }


def web_research(state: SummaryState, config: RunnableConfig):
    """LangGraph node that performs structured apartment search with LLM processing.

    Follows a 4-step process with LLM intervention:
    1. Search for neighborhoods + LLM extracts top 3
    2. Search apartments in those neighborhoods
    3. LLM processes and ranks apartment results
    4. LLM formats final top 10 with clean descriptions

    Args:
        state: Current graph state containing the search query and research loop count
        config: Configuration for the runnable, including search API settings

    Returns:
        Dictionary with state update, including sources_gathered, research_loop_count, and web_research_results
    """

    print("=== WEB_RESEARCH FUNCTION CALLED ===")
    print(f"Search query: {state.search_query}")

    # Configure
    configurable = Configuration.from_runnable_config(config)
    search_api = get_config_value(configurable.search_api)

    # Setup LLM
    if configurable.llm_provider == "gemini":
        llm = ChatGoogleGenerativeAI(
            model="gemini-2.0-flash", temperature=0, api_key=os.getenv("GEMINI_API_KEY")
        )
    else:
        llm = ChatOpenAI(
            model="gpt-4o-mini", temperature=0, api_key=os.getenv("OPENAI_API_KEY")
        )

    def perform_search(query: str, max_results: int = 5):
        """Helper function to perform search with configured API"""
        if search_api == "tavily":
            return tavily_search(
                query,
                fetch_full_page=configurable.fetch_full_page,
                max_results=max_results,
            )
        elif search_api == "perplexity":
            return perplexity_search(query, state.research_loop_count)
        elif search_api == "duckduckgo":
            return duckduckgo_search(
                query,
                max_results=max_results,
                fetch_full_page=configurable.fetch_full_page,
            )
        elif search_api == "searxng":
            return searxng_search(
                query,
                max_results=max_results,
                fetch_full_page=configurable.fetch_full_page,
            )
        else:
            raise ValueError(f"Unsupported search API: {configurable.search_api}")

    # Step 1: Search for neighborhoods and use LLM to extract top 3
    print("Step 1: Searching for neighborhoods...")

    # Extract location from search query for neighborhood search
    location_from_query = "San Francisco"  # Default
    if "near" in state.search_query:
        location_from_query = (
            state.search_query.split("near")[1].split("under")[0].strip()
        )
    elif "in" in state.search_query:
        location_from_query = (
            state.search_query.split("in")[1].split("under")[0].strip()
        )

    neighborhood_query = f"best neighborhoods for apartments in {location_from_query}"
    neighborhood_results = perform_search(neighborhood_query, max_results=10)

    # Use LLM to extract top 3 neighborhoods
    neighborhood_content = deduplicate_and_format_sources(
        neighborhood_results, max_tokens_per_source=500, fetch_full_page=False
    )

    neighborhood_prompt = f"""
Based on the search results below, extract the top 3 best neighborhoods for apartment hunting in {location_from_query}.

Search Results:
{neighborhood_content}

Return ONLY a JSON array of the 3 neighborhood names, like: ["Neighborhood1", "Neighborhood2", "Neighborhood3"]
"""

    neighborhood_response = llm.invoke(
        [
            SystemMessage(content="You are a helpful real estate assistant."),
            HumanMessage(content=neighborhood_prompt),
        ]
    )

    try:
        print("TRYING TO PARSE NEIGHBORHOODS...", neighborhood_response.content)
        neighborhoods = json.loads(neighborhood_response.content)
        print(f"LLM extracted neighborhoods: {neighborhoods}")
    except (json.JSONDecodeError, Exception) as e:
        # Fallback
        print(f"LLM neighborhood extraction failed: {e}")
        neighborhoods = ["SOMA", "Mission Bay", "Dogpatch"]
        print(f"Using fallback neighborhoods: {neighborhoods}")

    # Step 2 & 3: Search for apartments in those neighborhoods and process with LLM
    print("Step 2-3: Searching for apartments and processing with LLM...")

    all_apartment_results = []
    # Create apartment search query for each neighborhood
    apartment_query = f"based on this {state.search_query} find the top 10 apartments in {", ".join(neighborhoods)}"
    print(f"Searching for apartments: {apartment_query}")
    apartment_results = perform_search(apartment_query, max_results=10)
    all_apartment_results.extend(apartment_results.get("results", []))

    # Step 4: Use LLM to process and format top 10 apartments
    print("Step 4: LLM processing apartment results...")

    # Format raw results for LLM
    raw_apartments = ""
    for i, apt in enumerate(
        all_apartment_results[:15], 1
    ):  # Give LLM more options to choose from
        raw_apartments += f"\\n{i}. Title: {apt.get('title', 'No title')}\\n"
        raw_apartments += f"   URL: {apt.get('url', 'No URL')}\\n"
        raw_apartments += (
            f"   Description: {apt.get('content', 'No description')[:300]}...\\n"
        )

    apartment_processing_prompt = f"""
You are helping someone find apartments based on their requirements: {state.search_query}

From the search results below, select and format the TOP 10 most relevant apartments.

Raw Search Results:
{raw_apartments}

Return a JSON object with this structure:
{{
    "apartments": [
        {{
            "rank": 1,
            "title": "Clean apartment title",
            "url": "original_url",
            "description": "Clean 2-3 sentence description highlighting key features",
            "neighborhood": "extracted neighborhood name"
        }}
    ]
}}

Focus on apartments that best match the user's criteria. Clean up titles and create concise, helpful descriptions.
"""

    apartment_response = llm.invoke(
        [
            SystemMessage(content="You are a helpful real estate assistant."),
            HumanMessage(content=apartment_processing_prompt),
        ]
    )

    try:
        # Handle potential markdown formatting
        content = apartment_response.content
        if content.startswith("```json"):
            content = content.split("```json")[1].split("```")[0].strip()
        elif content.startswith("```"):
            content = content.split("```")[1].split("```")[0].strip()

        processed_apartments = json.loads(content)
        apartments_list = processed_apartments.get("apartments", [])[:10]
        print(f"LLM processed {len(apartments_list)} apartments")

    except Exception as e:
        print(f"LLM apartment processing failed: {e}")
        # Fallback formatting
        apartments_list = []
        for i, apt in enumerate(all_apartment_results[:10], 1):
            apartments_list.append(
                {
                    "rank": i,
                    "title": apt.get("title", "No title"),
                    "url": apt.get("url", "No URL"),
                    "description": apt.get("content", "No description")[:200] + "...",
                    "neighborhood": "Unknown",
                }
            )

    # Create final formatted output
    summary_text = f"Found {len(apartments_list)} apartments across neighborhoods: {', '.join(neighborhoods[:3])}\\n\\n"

    for apt in apartments_list:
        summary_text += f"{apt['rank']}. **{apt['title']}** ({apt.get('neighborhood', 'Unknown')})\\n"
        summary_text += f"   🔗 {apt['url']}\\n"
        summary_text += f"   📝 {apt['description']}\\n\\n"

    sources_list = [f"* {apt['title']} : {apt['url']}" for apt in apartments_list]

    print("=== WEB_RESEARCH COMPLETED ===")

    return {
        "sources_gathered": sources_list,
        "research_loop_count": state.research_loop_count + 1,
        "web_research_results": [summary_text],
    }


# def summarize_sources(state: SummaryState, config: RunnableConfig):
#     """LangGraph node that summarizes web research results.

#     Uses an LLM to create or update a running summary based on the newest web research
#     results, integrating them with any existing summary.

#     Args:
#         state: Current graph state containing research topic, running summary,
#               and web research results
#         config: Configuration for the runnable, including LLM provider settings

#     Returns:
#         Dictionary with state update, including running_summary key containing the updated summary
#     """

#     # Existing summary
#     existing_summary = state.running_summary

#     # Most recent web research
#     most_recent_web_research = state.web_research_results[-1]

#     # Build the human message
#     if existing_summary:
#         human_message_content = (
#             f"<Existing Summary> \n {existing_summary} \n <Existing Summary>\n\n"
#             f"<New Context> \n {most_recent_web_research} \n <New Context>"
#             f"Update the Existing Summary with the New Context on this topic: \n <User Input> \n {state.apartment_requirements} \n <User Input>\n\n"
#         )
#     else:
#         human_message_content = (
#             f"<Context> \n {most_recent_web_research} \n <Context>"
#             f"Create a Summary using the Context on this topic: \n <User Input> \n {state.apartment_requirements} \n <User Input>\n\n"
#         )

#     # Run the LLM
#     configurable = Configuration.from_runnable_config(config)

#     # Choose the appropriate LLM based on the provider
#     if configurable.llm_provider == "gemini":
#         llm = ChatGoogleGenerativeAI(
#             model="gemini-2.0-flash", temperature=0, api_key=os.getenv("GEMINI_API_KEY")
#         )
#     else:  # Default to OpenAI
#         llm = ChatOpenAI(
#             model="gpt-4o-mini", temperature=0, api_key=os.getenv("OPENAI_API_KEY")
#         )

#     result = llm.invoke(
#         [
#             SystemMessage(content=summarizer_instructions),
#             HumanMessage(content=human_message_content),
#         ]
#     )

#     # Strip thinking tokens if configured
#     running_summary = result.content
#     if configurable.strip_thinking_tokens:
#         running_summary = strip_thinking_tokens(running_summary)

#     return {"running_summary": running_summary}


# def reflect_on_summary(state: SummaryState, config: RunnableConfig):
#     """LangGraph node that identifies knowledge gaps and generates follow-up queries.

#     Analyzes the current summary to identify areas for further research and generates
#     a new search query to address those gaps. Uses structured output to extract
#     the follow-up query in JSON format.

#     Args:
#         state: Current graph state containing the running summary and research topic
#         config: Configuration for the runnable, including LLM provider settings

#     Returns:
#         Dictionary with state update, including search_query key containing the generated follow-up query
#     """

#     # Generate a query
#     configurable = Configuration.from_runnable_config(config)

#     # Choose the appropriate LLM based on the provider
#     if configurable.llm_provider == "gemini":
#         llm_json_mode = ChatGoogleGenerativeAI(
#             model="gemini-2.0-flash", temperature=0, api_key=os.getenv("GEMINI_API_KEY")
#         )
#     else:  # Default to OpenAI
#         llm_json_mode = ChatOpenAI(
#             model="gpt-4o-mini", temperature=0, api_key=os.getenv("OPENAI_API_KEY")
#         )

#     result = llm_json_mode.invoke(
#         [
#             SystemMessage(
#                 content=reflection_instructions.format(
#                     research_topic=state.apartment_requirements
#                 )
#             ),
#             HumanMessage(
#                 content=f"Reflect on our existing knowledge: \n === \n {state.running_summary}, \n === \n And now identify a knowledge gap and generate a follow-up web search query:"
#             ),
#         ]
#     )

#     # Strip thinking tokens if configured
#     try:
#         # Try to parse as JSON first
#         reflection_content = json.loads(result.content)
#         # Get the follow-up query
#         query = reflection_content.get("follow_up_query")
#         # Check if query is None or empty
#         if not query:
#             # Use a fallback query
#             return {
#                 "search_query": f"Tell me more about {state.apartment_requirements}"
#             }
#         return {"search_query": query}
#     except (json.JSONDecodeError, KeyError, AttributeError):
#         # If parsing fails or the key is not found, use a fallback query
#         return {"search_query": f"Tell me more about {state.apartment_requirements}"}


def google_maps_research(state: SummaryState, config: RunnableConfig):
    """LangGraph node that performs Google Maps review research.

    Uses the Google Maps Review Scraper MCP server to search for and analyze
    reviews for rental properties or locations mentioned in the research topic.

    Args:
        state: Current graph state containing the research topic and search query
        config: Configuration for the runnable

    Returns:
        Dictionary with state update, including sources_gathered and web_research_results
    """
    try:
        # Initialize Google Maps tools
        google_maps_tools = create_google_maps_tools_sync()

        if not google_maps_tools:
            # Fallback to regular web research if MCP tools aren't available
            return {
                "sources_gathered": ["Google Maps tools not available"],
                "web_research_results": [
                    "Google Maps research skipped - tools not available"
                ],
            }

        # Extract location/property from search query
        search_query = state.search_query

        # Try to find the search-place tool
        search_tool = None
        scrape_tool = None
        analyze_tool = None

        for tool in google_maps_tools:
            if tool.name == "search-place":
                search_tool = tool
            elif tool.name == "scrape-reviews":
                scrape_tool = tool
            elif tool.name == "analyze-reviews":
                analyze_tool = tool

        results = []

        # Step 1: Search for the place
        if search_tool:
            place_result = search_tool.invoke({"search_query": search_query})
            results.append(f"Place Search: {place_result}")

        # Step 2: Scrape reviews
        if scrape_tool:
            review_result = scrape_tool.invoke(
                {"search_query": search_query, "pages": 2, "sort_type": "newest"}
            )
            results.append(f"Reviews: {review_result}")

            # Step 3: Analyze reviews if we have data
            if analyze_tool and review_result:
                try:
                    analysis_result = analyze_tool.invoke(
                        {"reviews_data": review_result}
                    )
                    results.append(f"Analysis: {analysis_result}")
                except Exception as e:
                    results.append(f"Analysis failed: {str(e)}")

        # Format the results
        formatted_results = "\n\n".join(results)

        return {
            "sources_gathered": [f"Google Maps Research for: {search_query}"],
            "web_research_results": [formatted_results],
        }

    except Exception as e:
        return {
            "sources_gathered": [f"Google Maps research error: {str(e)}"],
            "web_research_results": [f"Google Maps research failed: {str(e)}"],
        }


def finalize_summary(state: SummaryState):
    """LangGraph node that finalizes the research summary.

    Prepares the final output by deduplicating and formatting sources, then
    combining them with the running summary to create a well-structured
    research report with proper citations.

    Args:
        state: Current graph state containing the running summary and sources gathered

    Returns:
        Dictionary with state update, including running_summary key containing the formatted final summary with sources
    """

    # Deduplicate sources before joining
    seen_sources = set()
    unique_sources = []

    for source in state.sources_gathered:
        # Split the source into lines and process each individually
        for line in source.split("\n"):
            # Only process non-empty lines
            if line.strip() and line not in seen_sources:
                seen_sources.add(line)
                unique_sources.append(line)

    # Join the deduplicated sources
    all_sources = "\n".join(unique_sources)
    state.running_summary = (
        f"## Summary\n{state.running_summary}\n\n ### Sources:\n{all_sources}"
    )
    return {"running_summary": state.running_summary}


def route_after_query(
    state: SummaryState, config: RunnableConfig
) -> Literal["web_research", "__end__"]:
    """Route after generate_query to determine if we need more info or can start searching.

    Args:
        state: Current graph state
        config: Configuration for the runnable

    Returns:
        String literal indicating next node
    """
    if state.ready_to_search:
        return "web_research"
    else:
        # End execution - user needs to provide more input
        return END


def route_research(
    state: SummaryState, config: RunnableConfig
) -> Literal["finalize_summary", "web_research", "google_maps_research"]:
    """LangGraph routing function that determines the next step in the research flow.

    Controls the research loop by deciding whether to continue gathering information,
    perform Google Maps research, or finalize the summary based on the research topic
    and configured maximum number of research loops.

    Args:
        state: Current graph state containing the research loop count and search query
        config: Configuration for the runnable, including max_web_research_loops setting

    Returns:
        String literal indicating the next node to visit
    """

    configurable = Configuration.from_runnable_config(config)

    # Check if this looks like a rental/housing-related query that would benefit from Google Maps
    rental_keywords = [
        "apartment",
        "rental",
        "rent",
        "housing",
        "building",
        "complex",
        "residence",
        "property",
    ]
    search_query_lower = state.search_query.lower() if state.search_query else ""
    research_topic_lower = (
        state.apartment_requirements.lower() if state.apartment_requirements else ""
    )

    is_rental_related = any(
        keyword in search_query_lower or keyword in research_topic_lower
        for keyword in rental_keywords
    )

    # If it's the first research loop and rental-related, try Google Maps first
    if state.research_loop_count == 1 and is_rental_related:
        return "google_maps_research"
    elif state.research_loop_count <= configurable.max_web_research_loops:
        return "web_research"
    else:
        return "finalize_summary"


# Add nodes and edges
builder = StateGraph(
    SummaryState,
    input=SummaryStateInput,
    output=SummaryStateOutput,
    config_schema=Configuration,
)
builder.add_node("generate_query", generate_query)
builder.add_node("web_research", web_research)
builder.add_node("google_maps_research", google_maps_research)
# builder.add_node("summarize_sources", summarize_sources)
# builder.add_node("reflect_on_summary", reflect_on_summary)
# builder.add_node("finalize_summary", finalize_summary)

# Add edges
builder.add_edge(START, "generate_query")
builder.add_conditional_edges("generate_query", route_after_query)
builder.add_edge("web_research", END)
# builder.add_edge("web_research", "summarize_sources")
# builder.add_edge("summarize_sources", "google_maps_research")
# builder.add_edge("google_maps_research", "reflect_on_summary")
# builder.add_conditional_edges("reflect_on_summary", route_research)
# builder.add_edge("finalize_summary", END)

graph = builder.compile()
