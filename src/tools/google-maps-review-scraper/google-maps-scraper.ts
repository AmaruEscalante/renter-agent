// Types
export type SortType = "relevent" | "newest" | "highest_rating" | "lowest_rating";

export interface ScraperOptions {
  sort_type?: SortType;
  search_query?: string;
  pages?: "max" | number;
  clean?: boolean;
}

export interface ReviewTime {
  published: string;
  last_edited?: string;
}

export interface Author {
  name: string;
  profile_url: string;
  url: string;
  id: string;
}

export interface Review {
  rating: number;
  text: string | null;
  language: string | null;
}

export interface ImageLocation {
  friendly?: string;
  lat: number;
  long: number;
}

export interface ImageSize {
  width: number;
  height: number;
}

export interface ReviewImage {
  id: string;
  url: string;
  size: ImageSize;
  location: ImageLocation;
  caption: string | null;
}

export interface ReviewResponse {
  text: string | null;
  time: {
    published: string | null;
    last_edited: string | null;
  };
}

export interface ParsedReview {
  review_id: string;
  time: ReviewTime;
  author: Author;
  review: Review;
  images: ReviewImage[] | null;
  source: string;
  response: ReviewResponse | null;
}

// Constants
const SortEnum: Record<SortType, number> = {
  "relevent": 1,
  "newest": 2,
  "highest_rating": 3,
  "lowest_rating": 4
};

// Utility Functions
function validateParams(url: string, sort_type: SortType, pages: "max" | number, clean: boolean): void {
  const parsedUrl = new URL(url);
  if (parsedUrl.host !== "www.google.com" || !parsedUrl.pathname.startsWith("/maps/place/")) {
    throw new Error(`Invalid URL: ${url}`);
  }
  if (!SortEnum[sort_type]) {
    throw new Error(`Invalid sort type: ${sort_type}`);
  }
  if (pages !== "max" && isNaN(Number(pages))) {
    throw new Error(`Invalid pages value: ${pages}`);
  }
  if (typeof clean !== "boolean") {
    throw new Error(`Invalid value for 'clean': ${clean}`);
  }
}

function buildApiUrl(url: string, so: number, pg: string = "", sq: string = ""): string {
  const m = [...url.matchAll(/!1s([a-zA-Z0-9_:]+)!/g)];
  if (!m || !m[0] || !m[0][1]) {
    throw new Error("Invalid URL");
  }
  const placeId = m[1]?.[1] ? m[1][1] : m[0][1];
  return `https://www.google.com/maps/rpc/listugcposts?authuser=0&hl=en&gl=in&pb=!1m7!1s${placeId}!3s${sq}!6m4!4m1!1e1!4m1!1e3!2m2!1i10!2s${pg}!5m2!1sBnOwZvzePPfF4-EPy7LK0Ak!7e81!8m5!1b1!2b1!3b1!5b1!7b1!11m6!1e3!2e1!3sen!4slk!6m1!1i2!13m1!1e${so}`;
}

async function fetchReviews(url: string, sort: number, nextPage: string = "", search_query: string = ""): Promise<any[]> {
  const apiUrl = buildApiUrl(url, sort, nextPage, search_query);
  const response = await fetch(apiUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch reviews: ${response.statusText}`);
  }
  const textData = await response.text();
  const rawData = textData.split(")]}'")[1];
  return JSON.parse(rawData);
}

async function parseReviews(reviews: any[]): Promise<ParsedReview[]> {
  const parsedReviews = await Promise.all(reviews.map(([review]) => {
    const hasResponse = !!review[3]?.[14]?.[0]?.[0];
    return {
      review_id: review[0],
      time: {
        published: review[1][2],
        last_edited: review[1][3],
      },
      author: {
        name: review[1][4][5][0],
        profile_url: review[1][4][5][1],
        url: review[1][4][5][2][0],
        id: review[1][4][5][3],
      },
      review: {
        rating: review[2][0][0],
        text: review[2][15]?.[0]?.[0] || null,
        language: review[2][14]?.[0] || null,
      },
      images: review[2][2]?.map((image: any) => ({
        id: image[0],
        url: image[1][6][0],
        size: {
          width: image[1][6][2][0],
          height: image[1][6][2][1],
        },
        location: {
          friendly: image[1][21][3][7]?.[0],
          lat: image[1][8][0][2],
          long: image[1][8][0][1],
        },
        caption: image[1][21][3][5]?.[0] || null,
      })) || null,
      source: review[1][13][0],
      response: hasResponse ? {
        text: review[3][14]?.[0]?.[0] || null,
        time: {
          published: review[3]?.[1] || null,
          last_edited: review[3]?.[2] || null,
        },
      } : null
    };
  }));

  return parsedReviews;
}

async function paginateReviews(
  url: string, 
  sort: number, 
  pages: "max" | number, 
  search_query: string, 
  clean: boolean, 
  initialData: any[]
): Promise<ParsedReview[] | any[]> {
  let reviews = initialData[2];
  let nextPage = initialData[1]?.replace(/"/g, "");
  let currentPage = 2;
  
  while (nextPage && (pages === "max" || currentPage <= Number(pages))) {
    console.log(`Scraping page ${currentPage}...`);
    const data = await fetchReviews(url, sort, nextPage, search_query);
    reviews = [...reviews, ...data[2]];
    nextPage = data[1]?.replace(/"/g, "");
    if (!nextPage) break;
    await new Promise(resolve => setTimeout(resolve, 1000)); // Avoid rate-limiting
    currentPage++;
  }
  
  return clean ? await parseReviews(reviews) : reviews;
}

// Main scraper function
export async function scraper(
  url: string, 
  options: ScraperOptions = {}
): Promise<ParsedReview[] | any[] | number | undefined> {
  const { 
    sort_type = "relevent", 
    search_query = "", 
    pages = "max", 
    clean = false 
  } = options;

  try {
    validateParams(url, sort_type, pages, clean);

    const sort = SortEnum[sort_type];
    const initialData = await fetchReviews(url, sort, "", search_query);

    if (!initialData || !initialData[2] || !initialData[2].length) return 0;

    if (!initialData[1] || pages === 1) {
      return clean ? await parseReviews(initialData[2]) : initialData[2];
    }

    return await paginateReviews(url, sort, pages, search_query, clean, initialData);
  } catch (e) {
    console.error(e);
    return;
  }
}