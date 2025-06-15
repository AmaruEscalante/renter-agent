import { scraper } from "google-maps-review-scraper";
import { chromium } from 'playwright';
import fs from 'fs';

async function getPlaceUrlFromSearch(searchQuery) {
  console.log(`Searching for: ${searchQuery}`);
  
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  try {
    // Navigate to Google Maps search
    const searchUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(searchQuery)}`;
    await page.goto(searchUrl, { waitUntil: 'load', timeout: 10000 });
    
    // Wait for the page to load and get the final URL
    await page.waitForTimeout(5000);
    
    // Get the current URL which should now be the place URL
    const placeUrl = page.url();
    console.log(`Found place URL: ${placeUrl}`);
    
    return placeUrl;
  } catch (error) {
    console.error('Error getting place URL:', error);
    throw error;
  } finally {
    await browser.close();
  }
}

async function scrapeReviews(searchQuery = "SoMA Square Apartments San Francisco CA") {
  try {
    let urlToScrape;
    
    if (searchQuery.startsWith('http')) {
      urlToScrape = searchQuery;
    } else {
      // Use Playwright to get the actual place URL
      urlToScrape = await getPlaceUrlFromSearch(searchQuery);
    }
    
    console.log(`Scraping reviews from: ${urlToScrape}`);
    
    const reviews = await scraper(
      urlToScrape,
      {
        sort_type: "newest",
        pages: 2,
        clean: true
      }
    );
    
    const parsedReviews = typeof reviews === 'string' ? JSON.parse(reviews) : reviews;
    
    console.log('Reviews scraped:', parsedReviews.length);
    
    // Convert timestamps to human readable dates
    const reviewsWithDates = parsedReviews.map(review => ({
      ...review,
      time: {
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
      },
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
    
    // Calculate statistics
    const ratings = reviewsWithDates.filter(review => review.review.rating).map(review => review.review.rating);
    const averageRating = ratings.length > 0 ? (ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length).toFixed(1) : null;
    
    const ratingDistribution = {
      5: ratings.filter(r => r === 5).length,
      4: ratings.filter(r => r === 4).length,
      3: ratings.filter(r => r === 3).length,
      2: ratings.filter(r => r === 2).length,
      1: ratings.filter(r => r === 1).length
    };

    // Find oldest and newest review dates
    const reviewDates = parsedReviews.map(review => new Date(review.time.published / 1000));
    const oldestReview = reviewDates.length > 0 ? new Date(Math.min(...reviewDates)).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    }) : null;
    const newestReview = reviewDates.length > 0 ? new Date(Math.max(...reviewDates)).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    }) : null;

    const outputData = {
      location: searchQuery.startsWith('http') ? "Location from URL" : searchQuery,
      totalReviews: reviewsWithDates.length,
      reviewsWithRatings: ratings.length,
      averageRating: parseFloat(averageRating),
      ratingDistribution: ratingDistribution,
      oldestReview: oldestReview,
      newestReview: newestReview,
      scrapedAt: new Date().toISOString(),
      reviews: reviewsWithDates
    };
    
    fs.writeFileSync('reviews.json', JSON.stringify(outputData, null, 2));
    console.log(`Saved ${parsedReviews.length} reviews to reviews.json`);
    console.log(`Average rating: ${averageRating}/5 stars`);
    console.log(`Review period: ${oldestReview} to ${newestReview}`);
    
  } catch (error) {
    console.error('Error scraping reviews:', error);
  }
}

scrapeReviews();