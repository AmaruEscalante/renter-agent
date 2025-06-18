import { scraper, ScraperOptions, ParsedReview } from './google-maps-scraper.js';

// Example usage
async function main() {
  const url = "https://www.google.com/maps/place/Bayside+Village/@37.7830337,-122.3999927,15z/data=!4m10!1m2!2m1!1sBayside+Village+apartments!3m6!1s0x8085807757501497:0x25374fff35068ae6!8m2!3d37.785173!4d-122.3900101!15sChpCYXlzaWRlIFZpbGxhZ2UgYXBhcnRtZW50c1ocIhpiYXlzaWRlIHZpbGxhZ2UgYXBhcnRtZW50c5IBF2FwYXJ0bWVudF9yZW50YWxfYWdlbmN5qgFrCgsvZy8xdGhsMTIzMgoJL20vMDFuYmx0EAEqDiIKYXBhcnRtZW50cygAMh8QASIbMrsAQC15cdSuBsYRLTqTKqNTiXhwH_5p1splMh4QAiIaYmF5c2lkZSB2aWxsYWdlIGFwYXJ0bWVudHPgAQA!16s%2Fg%2F1thl1232?entry=ttu&g_ep=EgoyMDI1MDYxNS4wIKXMDSoASAFQAw%3D%3D";
  
  // Basic usage - get raw reviews
  const rawReviews = await scraper(url);
  console.log('Raw reviews:', rawReviews);

  // Get cleaned/parsed reviews
  const options: ScraperOptions = {
    sort_type: "newest",
    pages: 5,
    clean: true,
    search_query: ""
  };

  const cleanReviews = await scraper(url, options) as ParsedReview[];
  console.log('Parsed reviews:', cleanReviews);

  // Get all reviews (max pages) with newest first
  const allReviews = await scraper(url, {
    sort_type: "newest",
    pages: "max",
    clean: true
  });
  console.log('All reviews:', allReviews);
}

// Uncomment to run
main().catch(console.error);