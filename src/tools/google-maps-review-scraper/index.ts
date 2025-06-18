#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { chromium } from 'playwright';
import { scraper, SortType } from "./google-maps-scraper.js";

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
        const { search_query, pages = 3, sort_type = "newest" } = args as { 
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
          sort_type: sort_type as SortType,
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
        
        // Handle large payloads by parsing only essential data
        let data;
        try {
          data = JSON.parse(reviews_data);
        } catch (error) {
          throw new Error("Invalid JSON data provided");
        }
        
        const reviews = data.reviews || [];
        
        if (!Array.isArray(reviews)) {
          throw new Error("Reviews data must contain an array of reviews");
        }
        
        // Limit analysis to prevent memory issues with large datasets
        const maxReviewsToAnalyze = 100;
        const reviewsToAnalyze = reviews.slice(0, maxReviewsToAnalyze);
        
        const stats = calculateReviewStats(reviewsToAnalyze);
        
        // Enhanced keyword lists for better analysis
        const positiveKeywords = ['great', 'excellent', 'amazing', 'love', 'fantastic', 'wonderful', 'perfect', 'best', 'awesome', 'highly recommend', 'helpful', 'friendly', 'clean', 'beautiful', 'nice', 'good', 'responsive', 'quick'];
        const negativeKeywords = ['terrible', 'awful', 'horrible', 'worst', 'hate', 'disgusting', 'disappointing', 'broken', 'dirty', 'rude', 'expensive', 'overpriced', 'theft', 'noise', 'loud', 'thin walls', 'problems', 'issues'];
        
        // Simplified sentiment analysis
        const sentimentCounts = { positive: 0, neutral: 0, negative: 0 };
        const keywordMatches: { positive: Record<string, number>, negative: Record<string, number> } = { positive: {}, negative: {} };
        const commonIssues: string[] = [];
        const commonPraises: string[] = [];
        
        reviewsToAnalyze.forEach((review: any) => {
          const text = review.review?.text?.toLowerCase() || '';
          const rating = review.review?.rating || 0;
          
          // Count sentiment
          if (rating >= 4) sentimentCounts.positive++;
          else if (rating <= 2) sentimentCounts.negative++;
          else sentimentCounts.neutral++;
          
          // Track keyword usage
          positiveKeywords.forEach(keyword => {
            if (text.includes(keyword)) {
              keywordMatches.positive[keyword] = (keywordMatches.positive[keyword] || 0) + 1;
            }
          });
          
          negativeKeywords.forEach(keyword => {
            if (text.includes(keyword)) {
              keywordMatches.negative[keyword] = (keywordMatches.negative[keyword] || 0) + 1;
            }
          });
          
          // Extract common issues and praises (simplified)
          if (text.includes('staff') && rating >= 4) commonPraises.push('Staff quality');
          if (text.includes('maintenance') && rating >= 4) commonPraises.push('Maintenance service');
          if (text.includes('amenities') && rating >= 4) commonPraises.push('Amenities');
          if (text.includes('location') && rating >= 4) commonPraises.push('Location');
          
          if (text.includes('expensive') || text.includes('overpriced')) commonIssues.push('High cost');
          if (text.includes('noise') || text.includes('loud')) commonIssues.push('Noise issues');
          if (text.includes('theft') || text.includes('stolen')) commonIssues.push('Security concerns');
          if (text.includes('maintenance') && rating <= 2) commonIssues.push('Maintenance problems');
        });
        
        // Get top keywords
        const topPositiveKeywords = Object.entries(keywordMatches.positive)
          .sort(([,a], [,b]) => (b as number) - (a as number))
          .slice(0, 5)
          .map(([keyword, count]) => ({ keyword, count }));
          
        const topNegativeKeywords = Object.entries(keywordMatches.negative)
          .sort(([,a], [,b]) => (b as number) - (a as number))
          .slice(0, 5)
          .map(([keyword, count]) => ({ keyword, count }));
        
        // Create simplified analysis result
        const analysisResult = {
          summary: {
            total_reviews: reviewsToAnalyze.length,
            average_rating: stats.averageRating,
            sentiment_breakdown: {
              positive: `${Math.round((sentimentCounts.positive / reviewsToAnalyze.length) * 100)}%`,
              neutral: `${Math.round((sentimentCounts.neutral / reviewsToAnalyze.length) * 100)}%`,
              negative: `${Math.round((sentimentCounts.negative / reviewsToAnalyze.length) * 100)}%`
            }
          },
          insights: {
            common_praises: [...new Set(commonPraises)].slice(0, 5),
            common_issues: [...new Set(commonIssues)].slice(0, 5),
            top_positive_keywords: topPositiveKeywords,
            top_negative_keywords: topNegativeKeywords
          },
          rating_distribution: stats.ratingDistribution,
          response_rate: `${Math.round((reviewsToAnalyze.filter((r: any) => r.response).length / reviewsToAnalyze.length) * 100)}%`,
          analyzed_at: new Date().toISOString(),
          note: reviews.length > maxReviewsToAnalyze ? `Analysis limited to first ${maxReviewsToAnalyze} reviews of ${reviews.length} total` : 'All reviews analyzed'
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