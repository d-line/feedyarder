import { describe, expect, it } from "vitest";

import {
  normalizeLearnGuide,
  parseLearnCategories,
  parseLearnCategoryPage,
  parseLearnGuideDetail,
  resolveLearnRootUrl
} from "./learn.js";

describe("parseLearnCategories", () => {
  it("extracts unique category links", () => {
    expect(
      parseLearnCategories(
        `<a href="/category/3d-printing">3D Printing</a>
         <a href="https://learn.adafruit.com/category/led-pixels">LED Pixels</a>
         <a href="/category/3d-printing">3D Printing</a>`,
        "https://learn.adafruit.com/categories"
      )
    ).toEqual([
      { title: "3D Printing", url: "https://learn.adafruit.com/category/3d-printing" },
      { title: "LED Pixels", url: "https://learn.adafruit.com/category/led-pixels" }
    ]);
  });
});

describe("parseLearnCategoryPage", () => {
  it("extracts guide cards and next pagination", () => {
    const result = parseLearnCategoryPage(
      `<h1 class="title">3D Printing</h1>
       <div class="guide-preview content-card">
         <a aria-hidden="true" href="/tetris-building">
           <div class="image-container">
             <img alt="Tetris image" class="image-preview" src="https://cdn-learn.adafruit.com/guides/cropped_images/000/004/516/medium640thumb/newguide.gif?1777387137">
           </div>
         </a>
         <div class="bottom-section">
           <div class="content">
             <a class="title" aria-label="Guide title" href="/tetris-building">MIT Green Building NeoPixel Tetris</a>
             <div class="author">By <a href="/u/pixil3d"><span class="name">Ruiz Brothers</span></a></div>
           </div>
           <div class="badges">
             <div class="badge" aria-label="Guide skill level">intermediate</div>
             <div class="badge favorites" title="Saved 1 times"><span>1</span></div>
             <div class="badge new" aria-label="This is a new guide">New</div>
           </div>
         </div>
       </div>
       <div class="pagination">
         <a rel="next" href="/category/3d-printing?guide_page=2">Next</a>
       </div>`,
      "https://learn.adafruit.com/category/3d-printing"
    );

    expect(result).toEqual({
      categoryTitle: "3D Printing",
      guides: [
        {
          author: "Ruiz Brothers",
          favoritesCount: 1,
          imageAlt: "Tetris image",
          imageUrl: "https://cdn-learn.adafruit.com/guides/cropped_images/000/004/516/medium640thumb/newguide.gif?1777387137",
          isNew: true,
          skillLevel: "intermediate",
          title: "MIT Green Building NeoPixel Tetris",
          url: "https://learn.adafruit.com/tetris-building"
        }
      ],
      nextPageUrl: "https://learn.adafruit.com/category/3d-printing?guide_page=2",
      pageNumber: 1
    });
  });
});

describe("parseLearnGuideDetail", () => {
  it("extracts guide details needed for item normalization", () => {
    const detail = parseLearnGuideDetail(
      `<head>
         <meta name="guide-title" content="MIT Green Building NeoPixel Tetris">
         <meta property="og:description" content="Make the iconic MIT Green Building Tetris hack.">
         <meta property="og:image" content="https://cdn-learn.adafruit.com/guides/images/000/004/516/medium800thumb/newguide.gif">
         <script type="application/ld+json">
           {"datePublished":"2026-04-28T12:03:45-04:00","author":{"name":"Ruiz Brothers"}}
         </script>
       </head>
       <article data-guide-id="4516">
         <div class="byline">by <a href="/u/pixil3d">Ruiz Brothers</a> and <a href="/u/BlitzCityDIY">Liz Clark</a></div>
         <div class="small">posted in <a href="/category/leds">LEDs</a> <a href="/category/3d-printing">3D Printing</a></div>
         <div class="badge skill-level" title="Skill Level">intermediate</div>
         <div class="badge skill-level" title="Guide Type">Project guide</div>
       </article>`,
      "https://learn.adafruit.com/tetris-building"
    );

    expect(detail).toEqual({
      author: "Ruiz Brothers, Liz Clark",
      categories: ["LEDs", "3D Printing"],
      description: "Make the iconic MIT Green Building Tetris hack.",
      guideId: "4516",
      guideType: "Project guide",
      imageUrl: "https://cdn-learn.adafruit.com/guides/images/000/004/516/medium800thumb/newguide.gif",
      publishedAt: "2026-04-28T16:03:45.000Z",
      skillLevel: "intermediate",
      title: "MIT Green Building NeoPixel Tetris"
    });
  });
});

describe("normalizeLearnGuide", () => {
  it("uses the Learn RSS-style guide id as the guid", () => {
    const item = normalizeLearnGuide(
      {
        author: "Ruiz Brothers",
        favoritesCount: 1,
        imageAlt: "Tetris image",
        imageUrl: "https://cdn-learn.adafruit.com/guides/cropped_images/000/004/516/medium640thumb/newguide.gif",
        isNew: true,
        skillLevel: "intermediate",
        title: "MIT Green Building NeoPixel Tetris",
        url: "https://learn.adafruit.com/tetris-building"
      },
      {
        author: "Ruiz Brothers, Liz Clark",
        categories: ["LEDs", "3D Printing"],
        description: "Make the iconic MIT Green Building Tetris hack.",
        guideId: "4516",
        guideType: "Project guide",
        imageUrl: "https://cdn-learn.adafruit.com/guides/images/000/004/516/medium800thumb/newguide.gif",
        publishedAt: "2026-04-28T16:03:45.000Z",
        skillLevel: "intermediate",
        title: "MIT Green Building NeoPixel Tetris"
      },
      "feed-id",
      { title: "3D Printing", url: "https://learn.adafruit.com/category/3d-printing" },
      "https://learn.adafruit.com/category/3d-printing"
    );

    expect(item).toMatchObject({
      author: "Ruiz Brothers, Liz Clark",
      guid: "tag:learn.adafruit.com,2005:Guides::External/4516",
      publishedAt: "2026-04-28T16:03:45.000Z",
      rawExtensionData: {
        adafruitLearn: {
          categories: ["LEDs", "3D Printing"],
          guideId: "4516",
          sourceCategory: {
            title: "3D Printing",
            url: "https://learn.adafruit.com/category/3d-printing"
          }
        }
      },
      title: "MIT Green Building NeoPixel Tetris",
      url: "https://learn.adafruit.com/tetris-building"
    });
  });
});

describe("resolveLearnRootUrl", () => {
  it("resolves Learn URLs to the root", () => {
    expect(resolveLearnRootUrl("https://learn.adafruit.com/category/3d-printing").toString()).toBe(
      "https://learn.adafruit.com/"
    );
  });
});
