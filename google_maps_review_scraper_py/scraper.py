import json
from . import utils
from .utils import Sort

async def scraper(url, sort_type="relevant", search_query="", pages="max", clean=False):
    try:
        if sort_type == "relevent":
            sort_type = "relevant"

        utils.validate_params(url, sort_type, pages, clean)

        sort = Sort[sort_type.upper()].value
        initial_data = await utils.fetch_reviews(url, sort, "", search_query)

        if not initial_data or not _get_safe(initial_data, 2):
            return 0

        if not _get_safe(initial_data, 1) or pages == 1:
            reviews_data = _get_safe(initial_data, 2)
            return utils.parse_reviews(reviews_data) if clean else reviews_data

        return await utils.paginate_reviews(url, sort, pages, search_query, clean, initial_data)
    except Exception as e:
        print(f"An error occurred: {e}")
        return

def _get_safe(data, *keys):
    for key in keys:
        try:
            data = data[key]
        except (IndexError, TypeError, KeyError):
            return None
    return data 