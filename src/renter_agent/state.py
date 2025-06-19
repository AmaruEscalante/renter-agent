import operator
from dataclasses import dataclass, field
from typing_extensions import Annotated
from langgraph.graph.message import add_messages
from langchain_core.messages import AnyMessage


@dataclass(kw_only=True)
class SummaryState:
    messages: Annotated[list[AnyMessage], add_messages] = field(default_factory=list)
    apartment_requirements: str = field(default=None)  # Apartment requirements
    search_query: str = field(default=None)  # Search query
    web_research_results: Annotated[list, operator.add] = field(default_factory=list)
    sources_gathered: Annotated[list, operator.add] = field(default_factory=list)
    research_loop_count: int = field(default=0)  # Research loop count
    running_summary: str = field(default=None)  # Final report
    ready_to_search: bool = field(
        default=False
    )  # Whether we have enough info to begin search


@dataclass(kw_only=True)
class SummaryStateInput:
    apartment_requirements: str = field(default=None)  # Apartment requirements


@dataclass(kw_only=True)
class SummaryStateOutput:
    running_summary: str = field(default=None)  # Final report
