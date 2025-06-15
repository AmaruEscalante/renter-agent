import asyncio
import json
import re
from enum import Enum
from urllib.parse import urlparse

import httpx


class Sort(Enum):
    RELEVANT = 1
    NEWEST = 2
    HIGHEST_RATING = 3
    LOWEST_RATING = 4


def validate_params(url, sort_type, pages, clean):
    parsed_url = urlparse(url)
    if parsed_url.netloc != "www.google.com" or not parsed_url.path.startswith("/maps/place/"):
        raise ValueError(f"Invalid URL: {url}")

    if sort_type.upper() not in Sort.__members__:
        raise ValueError(f"Invalid sort type: {sort_type}")

    if pages != "max":
        try:
            if int(pages) <= 0:
                raise ValueError
        except (ValueError, TypeError):
            raise ValueError(f"Invalid pages value: {pages}")

    if not isinstance(clean, bool):
        raise ValueError(f"Invalid value for 'clean': {clean}")


def listugcposts(url, so, pg="", sq=""):
    matches = list(re.finditer(r'!1s([a-zA-Z0-9_:]+)!', url))
    if not matches:
        raise ValueError("Invalid URL: placeId not found.")

    place_id = matches[1].group(1) if len(matches) > 1 and matches[1].group(1) else matches[0].group(1)

    return f"https://www.google.com/maps/rpc/listugcposts?authuser=0&hl=en&gl=in&pb=!1m7!1s{place_id}!3s{sq}!6m4!4m1!1e1!4m1!1e3!2m2!1i10!2s{pg}!5m2!1sBnOwZvzePPfF4-EPy7LK0Ak!7e81!8m5!1b1!2b1!3b1!5b1!7b1!11m6!1e3!2e1!3sen!4slk!6m1!1i2!13m1!1e{so}"


async def fetch_reviews(url, sort, next_page="", search_query=""):
    api_url = listugcposts(url, sort, next_page, search_query)
    async with httpx.AsyncClient() as client:
        response = await client.get(api_url)

    response.raise_for_status()

    text_data = response.text
    raw_data = text_data.split(")]}'")[1]
    return json.loads(raw_data)


def _get_safe(data, *keys):
    for key in keys:
        try:
            data = data[key]
        except (IndexError, TypeError, KeyError):
            return None
    return data


def parse_reviews(reviews):
    parsed_reviews = []
    for review_container in reviews:
        review = _get_safe(review_container, 0)
        if not review:
            continue

        has_response = _get_safe(review, 3, 14, 0, 0) is not None

        images = None
        if (image_data := _get_safe(review, 2, 2)) is not None:
            images = [
                {
                    'id': _get_safe(image, 0),
                    'url': _get_safe(image, 1, 6, 0),
                    'size': {
                        'width': _get_safe(image, 1, 6, 2, 0),
                        'height': _get_safe(image, 1, 6, 2, 1),
                    },
                    'location': {
                        'friendly': _get_safe(image, 1, 21, 3, 7, 0),
                        'lat': _get_safe(image, 1, 8, 0, 2),
                        'long': _get_safe(image, 1, 8, 0, 1),
                    },
                    'caption': _get_safe(image, 1, 21, 3, 5, 0) or None,
                }
                for image in image_data
            ]

        parsed_review = {
            'review_id': _get_safe(review, 0),
            'time': {
                'published': _get_safe(review, 1, 2),
                'last_edited': _get_safe(review, 1, 3),
            },
            'author': {
                'name': _get_safe(review, 1, 4, 5, 0),
                'profile_url': _get_safe(review, 1, 4, 5, 1),
                'url': _get_safe(review, 1, 4, 5, 2, 0),
                'id': _get_safe(review, 1, 4, 5, 3),
            },
            'review': {
                'rating': _get_safe(review, 2, 0, 0),
                'text': _get_safe(review, 2, 15, 0, 0) or None,
                'language': _get_safe(review, 2, 14, 0) or None,
            },
            'images': images,
            'source': _get_safe(review, 1, 13, 0),
            'response': {
                'text': _get_safe(review, 3, 14, 0, 0) or None,
                'time': {
                    'published': _get_safe(review, 3, 1) or None,
                    'last_edited': _get_safe(review, 3, 2) or None,
                },
            } if has_response else None,
        }
        parsed_reviews.append(parsed_review)
    return json.dumps(parsed_reviews, indent=2)


async def paginate_reviews(url, sort, pages, search_query, clean, initial_data):
    reviews = initial_data[2]
    next_page = initial_data[1].replace('"', '') if _get_safe(initial_data, 1) else None
    current_page = 2

    pages_to_scrape = float('inf') if pages == "max" else int(pages)

    while next_page and current_page <= pages_to_scrape:
        print(f"Scraping page {current_page}...")
        try:
            data = await fetch_reviews(url, sort, next_page, search_query)
            if _get_safe(data, 2):
                reviews.extend(data[2])

            next_page = data[1].replace('"', '') if _get_safe(data, 1) else None

            if not next_page:
                break

            await asyncio.sleep(1)
            current_page += 1
        except Exception as e:
            print(f"Error scraping page {current_page}: {e}")
            break

    return parse_reviews(reviews) if clean else reviews 