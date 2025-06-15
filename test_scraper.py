import asyncio
import json
from google_maps_review_scraper_py import scraper

async def main():
    """
    An example of how to use the scraper.
    This will scrape the first page of the newest reviews for the Eiffel Tower,
    and print the cleaned JSON output.
    """
    url = "https://www.google.com/maps/place/Bayside+Village/@37.7867949,-122.3949672,15.11z/data=!4m10!1m2!2m1!1sbay+side+apartments!3m6!1s0x8085807757501497:0x25374fff35068ae6!8m2!3d37.785173!4d-122.3900101!15sChNiYXkgc2lkZSBhcGFydG1lbnRzWhUiE2JheSBzaWRlIGFwYXJ0bWVudHOSARdhcGFydG1lbnRfcmVudGFsX2FnZW5jeaoBRgoJL20vMDFuYmx0EAEyHhABIhp30pRDFlEi-t0bMoa9IccZcKYz7uZKr-gvCzIXEAIiE2JheSBzaWRlIGFwYXJ0bWVudHPgAQA!16s%2Fg%2F1thl1232?entry=ttu&g_ep=EgoyMDI1MDYxMS4wIKXMDSoASAFQAw%3D%3D"
    
    print(f"Scraping reviews for: {url}")
    
    # Scrape with clean=True to get a parsed JSON output
    # Set pages=1 to just get the first page of results for this test
    reviews = await scraper(url, sort_type="newest", pages=1, clean=True)
    
    print("\n--- Scraping Results (JSON) ---\n")
    print(reviews)

    # Example of getting raw data
    # print("\n--- Scraping Results (Raw) ---\n")
    # raw_reviews = await scraper(url, sort_type="newest", pages=1, clean=False)
    # print(json.dumps(raw_reviews, indent=2))


if __name__ == "__main__":
    asyncio.run(main()) 