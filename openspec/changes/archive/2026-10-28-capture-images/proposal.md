# Proposal

## Why

Agents can now read change requests over MCP, but only as text: the element names and selectors someone pointed at, and a recording's duration and errors. For a visual change request the most useful thing is to see the page, and for a recording, what the person did. Claude and other agents can look at images a tool returns, but not at video, so recordings need a written account of the steps plus a few stills.

## What Changes

- **Recording timeline in the digest.** `get_feedback` lists what happened in each recording, with times. The entries are:
  - navigations;
  - clicks and taps, naming the element;
  - typing in a field (never the value);
  - checkbox changes and viewport resizes;
  - captured errors.

  It is built on the server from the stored recording, so it works without a browser.
- **Capture images.** The server draws each capture as an image from its stored recording, in a headless Chromium. A point capture shows the viewport as it was captured, with the selected elements outlined. A recording shows its last frame. Images are drawn the first time an agent asks, then kept.
  - `get_feedback` returns these images with the digest.
- **Recording storyboard.** A new tool, `get_capture_frames(itemId, capture)`, returns up to 6 stills of a recording, for when the agent needs the steps.
  - The stills are taken after each click, typing pause and navigation, plus the first and last moments. Identical frames are dropped.
  - Each still is captioned with its timeline entry, and the clicked element is outlined.
  - For a point capture, the tool returns its single image.
- **Images are optional.**
  - Without a usable Chromium, or with `CAPTURE_IMAGES=off`, the digest stays text-only and says images aren't available on this server.
  - The Docker image includes Chromium.
- **Isolated rendering.**
  - The replayed page runs no scripts.
  - The renderer only loads resources from the project's allowed origins, without following redirects.
  - Rendering has time and concurrency limits.
- No change to the in-page SDK or to what reports contain. Images show the same masked inputs the recording already has.

## Capabilities

### New Capabilities
- `capture-rendering`: server-side drawing of capture stills and recording storyboards from stored recordings, covering:
  - when it is available;
  - isolation and limits;
  - caching;
  - which frames a storyboard contains.

### Modified Capabilities
- `mcp-server`: four requirements change.
  - the tool list gains `get_capture_frames`;
  - the digest gains the recording timeline and the capture images;
  - the "No raw recording data" rule now allows rendered images and the timeline's element descriptions, and still forbids raw recording data;
  - there is a new requirement for the storyboard tool.

## Impact

- **`apps/server`:**
  - new modules: `capture/timeline.ts` (pure: a node map built from the snapshot and its mutations, timeline entries, element descriptions) and `render/` (a browser pool, a render page that uses the replay bundle, a request allowlist, and a cache in the blob store);
  - MCP tools return image content;
  - new config: `CAPTURE_IMAGES` (`auto` or `off`) and `CHROMIUM_PATH`.
- **Replay bundle (`packages/sdk/src/replay`):** the handle gains a way to read a node's position, used to outline clicked elements. Only the replay bundle changes; the in-page runtime doesn't.
- **Dependencies:**
  - `playwright-core`, pinned to the version the e2e suite uses (1.64.1), on the server;
  - the Chromium headless shell in the Docker image, about +600 MB (browser, system libraries and fonts).
- **Storage:** renders are stored as blobs under `projects/<id>/renders/<itemId>/`, so deleting the project deletes them.
- **README:** what agents see, the config options, and the Docker image size note.
