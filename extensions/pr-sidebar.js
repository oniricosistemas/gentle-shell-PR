import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { Markdown } from "@earendil-works/pi-tui";

import { createPrSidebarExtension } from "../src/extension.js";

function renderMarkdown(markdown, width) {
  return new Markdown(markdown, 0, 0, getMarkdownTheme()).render(width);
}

export default createPrSidebarExtension({ renderMarkdown });
