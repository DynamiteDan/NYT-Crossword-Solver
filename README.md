# NYT Crossword Answer Helper (Edge Extension)

An experimental Microsoft Edge extension that reveals the answer to any New York Times crossword clue as soon as you click the hint inside the official puzzle interface.

## How it works
- Injects a content script on `nytimes.com/crossword` pages.
- Detects the puzzle date from the URL, downloads the matching archive page from [nytcrosswordanswers.org](https://nytcrosswordanswers.org/), and parses every clue/answer pair.
- Maps each clue number (e.g. `17A`, `42D`) to its official answer.
- Watches the DOM for clue elements, and whenever you click one it pops open a floating answer panel (so nothing is injected into the clue list itself).

## Install in Microsoft Edge
1. Open Edge and go to `edge://extensions`.
2. Enable **Developer mode** (toggle in the lower-left corner).
3. Click **Load unpacked** and choose the `NYTimes Crossword Solver/extension` folder.
4. Navigate to any NYT crossword puzzle (e.g. `https://www.nytimes.com/crossword/game/daily/...`).
5. Click a clue in the Across/Down list to reveal its answer; click again to hide it.

## Development notes
- All extension assets live in `extension/`.
- `manifest.json` registers a single content script (`content-script.js`).
- The script injects minimal CSS for the answer pill and uses a `MutationObserver` so it survives React re-renders.
- No build step is required; edit the files and reload the unpacked extension in Edge to pick up changes.

## Limitations & next steps
- Tailored to NYT crossword pages; supporting other sites would require new selectors and data sources.
- Answers are only available when nytcrosswordanswers.org has already published that day's solution (and when the puzzle date can be inferred from the URL).
- Consider adding a popup UI for toggling the behavior or copying answers, plus automated tests using Playwright for regression coverage.

