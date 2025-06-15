#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { chromium } from 'playwright';

// @ts-ignore
import { scraper } from "google-maps-review-scraper";

const server = new Server({
  name: "google-maps-review-scraper",
  version: "1.0.0",
}, {
  capabilities: {
    tools: {},
  },
});

// Helper function to get place URL from search query
async function getPlaceUrlFromSearch(searchQuery: string): Promise<string> {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  try {
    const searchUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(searchQuery)}`;
    await page.goto(searchUrl, { waitUntil: 'load', timeout: 15000 });
    await page.waitForTimeout(5000);
    
    const placeUrl = page.url();
    return placeUrl;
  } catch (error: any) {
    throw new Error(`Failed to get place URL: ${error.message}`);
  } finally {
    await browser.close();
  }
}

// Helper function to calculate review statistics
function calculateReviewStats(reviews: any[]) {
  const ratings = reviews.filter(review => review.review?.rating).map(review => review.review.rating);
  const averageRating = ratings.length > 0 ? (ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length) : 0;
  
  const ratingDistribution = {
    5: ratings.filter(r => r === 5).length,
    4: ratings.filter(r => r === 4).length,
    3: ratings.filter(r => r === 3).length,
    2: ratings.filter(r => r === 2).length,
    1: ratings.filter(r => r === 1).length
  };

  const reviewTexts = reviews.filter(review => review.review?.text).map(review => review.review.text);
  const averageTextLength = reviewTexts.length > 0 ? Math.round(reviewTexts.reduce((sum, text) => sum + text.length, 0) / reviewTexts.length) : 0;

  const reviewDates = reviews.map(review => new Date(review.time?.published || 0)).filter(date => date.getTime() > 0);
  const oldestReview = reviewDates.length > 0 ? new Date(Math.min(...reviewDates.map(d => d.getTime()))) : null;
  const newestReview = reviewDates.length > 0 ? new Date(Math.max(...reviewDates.map(d => d.getTime()))) : null;

  return {
    totalReviews: reviews.length,
    reviewsWithRatings: ratings.length,
    averageRating: Math.round(averageRating * 10) / 10,
    ratingDistribution,
    averageTextLength,
    oldestReview: oldestReview?.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
    newestReview: newestReview?.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
  };
}

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "search-place",
        description: "Search for a place and get its Google Maps URL",
        inputSchema: {
          type: "object",
          properties: {
            search_query: {
              type: "string",
              description: "Search query for the place (e.g., 'SoMA Square Apartments San Francisco CA')"
            }
          },
          required: ["search_query"]
        }
      },
      {
        name: "scrape-reviews",
        description: "Scrape Google Maps reviews for a place",
        inputSchema: {
          type: "object",
          properties: {
            search_query: {
              type: "string",
              description: "Search query or Google Maps URL for the place"
            },
            pages: {
              type: "number",
              description: "Number of pages to scrape (1-10, default: 2)",
              minimum: 1,
              maximum: 10,
              default: 2
            },
            sort_type: {
              type: "string",
              description: "Sort order for reviews",
              enum: ["newest", "oldest", "most_relevant", "highest_rating", "lowest_rating"],
              default: "newest"
            }
          },
          required: ["search_query"]
        }
      },
      {
        name: "analyze-reviews",
        description: "Analyze review data for insights and sentiment",
        inputSchema: {
          type: "object",
          properties: {
            reviews_data: {
              type: "string",
              description: "JSON string of reviews data to analyze"
            }
          },
          required: ["reviews_data"]
        }
      }
    ]
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "search-place": {
        const { search_query } = args as { search_query: string };
        const placeUrl = await getPlaceUrlFromSearch(search_query);
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                search_query,
                google_maps_url: placeUrl,
                status: "success"
              }, null, 2),
            },
          ],
        };
      }

      case "scrape-reviews": {
        const { search_query, pages = 2, sort_type = "newest" } = args as { 
          search_query: string; 
          pages?: number; 
          sort_type?: string; 
        };
        
        let urlToScrape: string;
        
        if (search_query.startsWith('http')) {
          urlToScrape = search_query;
        } else {
          urlToScrape = await getPlaceUrlFromSearch(search_query);
        }
        
        const reviews = await scraper(urlToScrape, {
          sort_type,
          pages,
          clean: true
        });
        
        const parsedReviews = typeof reviews === 'string' ? JSON.parse(reviews) : reviews;
        
        // Convert timestamps to human readable dates
        const reviewsWithDates = parsedReviews.map((review: any) => ({
          ...review,
          time: review.time ? {
            published: new Date(review.time.published / 1000).toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'long',
              day: 'numeric'
            }),
            last_edited: new Date(review.time.last_edited / 1000).toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'long',
              day: 'numeric'
            })
          } : null,
          response: review.response ? {
            ...review.response,
            time: {
              published: new Date(review.response.time.published / 1000).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
              }),
              last_edited: new Date(review.response.time.last_edited / 1000).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
              })
            }
          } : null
        }));
        
        const stats = calculateReviewStats(reviewsWithDates);
        
        const outputData = {
          location: search_query.startsWith('http') ? "Location from URL" : search_query,
          url: urlToScrape,
          scrapedAt: new Date().toISOString(),
          scrapeParams: { pages, sort_type },
          ...stats,
          reviews: reviewsWithDates
        };
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(outputData, null, 2),
            },
          ],
        };
      }

      case "analyze-reviews": {
        const { reviews_data } = args as { reviews_data: string };
        const data = JSON.parse(reviews_data);
        const reviews = data.reviews || [];
        
        if (!Array.isArray(reviews)) {
          throw new Error("Reviews data must contain an array of reviews");
        }
        
        const stats = calculateReviewStats(reviews);
        
        // Sentiment analysis based on ratings and keywords
        const positiveKeywords = ['great', 'excellent', 'amazing', 'love', 'fantastic', 'wonderful', 'perfect', 'best', 'awesome', 'highly recommend'];
        const negativeKeywords = ['terrible', 'awful', 'horrible', 'worst', 'hate', 'disgusting', 'disappointing', 'broken', 'dirty', 'rude'];
        
        const reviewAnalysis = reviews.map((review: any) => {
          const text = review.review?.text?.toLowerCase() || '';
          const rating = review.review?.rating || 0;
          
          const positiveMatches = positiveKeywords.filter(keyword => text.includes(keyword));
          const negativeMatches = negativeKeywords.filter(keyword => text.includes(keyword));
          
          return {
            review_id: review.review_id,
            rating,
            sentiment: rating >= 4 ? 'positive' : rating <= 2 ? 'negative' : 'neutral',
            positive_keywords: positiveMatches,
            negative_keywords: negativeMatches,
            text_length: text.length,
            has_response: !!review.response
          };
        });
        
        const sentimentCounts = {
          positive: reviewAnalysis.filter(r => r.sentiment === 'positive').length,
          neutral: reviewAnalysis.filter(r => r.sentiment === 'neutral').length,
          negative: reviewAnalysis.filter(r => r.sentiment === 'negative').length
        };
        
        const commonPositiveKeywords = positiveKeywords
          .map(keyword => ({
            keyword,
            count: reviews.filter((r: any) => r.review?.text?.toLowerCase().includes(keyword)).length
          }))
          .filter(item => item.count > 0)
          .sort((a, b) => b.count - a.count)
          .slice(0, 10);
        
        const commonNegativeKeywords = negativeKeywords
          .map(keyword => ({
            keyword,
            count: reviews.filter((r: any) => r.review?.text?.toLowerCase().includes(keyword)).length
          }))
          .filter(item => item.count > 0)
          .sort((a, b) => b.count - a.count)
          .slice(0, 10);
        
        const analysisResult = {
          ...stats,
          sentiment_analysis: {
            sentiment_distribution: sentimentCounts,
            sentiment_percentage: {
              positive: Math.round((sentimentCounts.positive / reviews.length) * 100),
              neutral: Math.round((sentimentCounts.neutral / reviews.length) * 100),
              negative: Math.round((sentimentCounts.negative / reviews.length) * 100)
            }
          },
          keyword_analysis: {
            common_positive_keywords: commonPositiveKeywords,
            common_negative_keywords: commonNegativeKeywords
          },
          review_responses: {
            total_responses: reviewAnalysis.filter(r => r.has_response).length,
            response_rate: Math.round((reviewAnalysis.filter(r => r.has_response).length / reviews.length) * 100)
          },
          analyzed_at: new Date().toISOString()
        };
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(analysisResult, null, 2),
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error: any) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: error.message,
            status: "failed"
          }, null, 2),
        },
      ],
      isError: true,
    };
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Google Maps Review Scraper MCP server running on stdio");
}

main().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});