# Google Maps Review Scraper (Python)

This is a Python version of the [google-maps-review-scraper](https://github.com/YasogaN/google-maps-review-scraper).

It allows you to scrape reviews from Google Maps for a specific place.

## Installation

1.  Clone the repository.
2.  Install the dependencies:
    ```bash
    pip install -r requirements.txt
    ```

## Usage

You can use the `scraper` function from the `google_maps_review_scraper_py` package.

Here is an example of how to use it in your own Python script:

```python
import asyncio
from google_maps_review_scraper_py import scraper

async def main():
    url = "https://www.google.com/maps/place/your_place_url_here"
    reviews = await scraper(url, sort_type="newest", pages=2, clean=True)
    print(reviews)

if __name__ == "__main__":
    asyncio.run(main())
```

### Parameters

-   `url` (string, required): The Google Maps URL of the place.
-   `sort_type` (string, optional): The sorting order for reviews. Defaults to `relevant`.
    -   `relevant`
    -   `newest`
    -   `highest_rating`
    -   `lowest_rating`
-   `search_query` (string, optional): A query to filter reviews by.
-   `pages` (string or int, optional): The number of pages to scrape. Defaults to `"max"`. Can be an integer.
-   `clean` (boolean, optional): Set to `True` to get a cleaned and parsed JSON output. Defaults to `False`, which returns the raw (but still usable) review data.

## Original Project

For more information, please refer to the original [JavaScript project's README](https://github.com/YasogaN/google-maps-review-scraper/blob/main/ReadMe.md).

## Acknowledgements

This project is a Python port of the original JavaScript-based [google-maps-review-scraper](https://github.com/YasogaN/google-maps-review-scraper) created by [YasogaN](https://github.com/YasogaN). Full credit for the original implementation and research goes to them.
