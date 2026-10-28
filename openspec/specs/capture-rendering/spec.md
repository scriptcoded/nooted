# capture-rendering Specification

## Purpose
Draws captures as images on the server, from their stored recordings, so agents can see what the reporter saw: a still per capture and a storyboard of a recording's key moments. Covers when rendering is available, its isolation and limits, frame selection and caching.

## Requirements

### Requirement: Availability
The server SHALL draw capture images only when image rendering is enabled and a usable Chromium is found at startup or on first use. With `CAPTURE_IMAGES=off`, or when no Chromium can be launched, rendering SHALL be unavailable and every other feature SHALL keep working.

#### Scenario: No Chromium
- **WHEN** the server runs without a Chromium it can launch
- **THEN** reports are still received, the console and MCP still work, and image requests report that images aren't available on this server

#### Scenario: Turned off
- **WHEN** `CAPTURE_IMAGES=off` is set
- **THEN** the server never starts a browser and image requests report that images aren't available

### Requirement: Capture still
For a point capture, the still SHALL show the captured viewport at its captured size and scroll position, with each selected element outlined. For a recording, the still SHALL show its last frame. Inputs SHALL appear as masked as they are in the stored recording. Each image SHALL be a JPEG no larger than 1568 pixels on its longest side.

#### Scenario: Selected button
- **WHEN** a point capture selected an "Add to cart" button
- **THEN** its still shows the page as captured with an outline around that button

#### Scenario: Masked input
- **WHEN** a capture's page had text typed into a field
- **THEN** the still shows the field's masked value, never the typed text

### Requirement: Recording storyboard
For a recording, the storyboard SHALL be a sequence of at most 6 stills in time order. Each still is taken at one of these moments:
- the start of the recording;
- just after a click or tap, with the clicked element outlined;
- the end of a typing pause in a field;
- just after a navigation;
- a captured error;
- the end of the recording.

Each still SHALL carry a caption with its time and the timeline entry it shows.

#### Scenario: Click then navigate
- **WHEN** a 5-second recording shows a click on "Checkout" followed by a navigation to /checkout
- **THEN** the storyboard holds the start, the frame after the click with "Checkout" outlined, the frame after the navigation, and the end (if it differs), in that order and captioned

### Requirement: Storyboard selection
A still identical to the one before it SHALL be dropped. When more than 6 moments remain, the first and last SHALL be kept, then navigations, clicks, errors and typing, in that order of priority.

#### Scenario: Nothing changes
- **WHEN** a recording ends with a click that changes nothing on the page
- **THEN** the frame after that click is dropped as identical to the one before it

#### Scenario: Many actions
- **WHEN** a recording contains 15 clicks
- **THEN** the storyboard holds at most 6 stills, including the first and the last moment

### Requirement: Rendering isolation
The rendered page SHALL NOT run scripts from the recording. While rendering, the server SHALL only load resources:
- from inline data;
- over http(s) from one of the project's allowed origins, without following redirects.

All other requests, including other origins, private addresses outside the allowlist, websockets and service workers, SHALL be blocked. A missing resource SHALL NOT fail the render.

#### Scenario: Image from an allowed origin
- **WHEN** a captured page shows an image from the project's allowed origin
- **THEN** the still shows that image

#### Scenario: Request to another host
- **WHEN** a recording references `http://169.254.169.254/latest/meta-data` or any origin not in the project's allowed origins
- **THEN** the renderer does not make that request and the still is drawn without it

#### Scenario: Redirect
- **WHEN** an allowed origin answers a resource request with a redirect to another host
- **THEN** the redirect is not followed

### Requirement: Rendering limits
A single render SHALL time out after 20 seconds, and the server SHALL run at most 2 renders at a time, queueing the rest. A failed or timed-out render SHALL NOT be cached as a result, and callers SHALL get the text without that image.

#### Scenario: Slow page
- **WHEN** a render does not finish within 20 seconds
- **THEN** it is stopped, the agent receives the digest with a note that the image could not be drawn, and a later request tries again

### Requirement: Render cache
A finished still or storyboard SHALL be stored and reused for later requests for the same capture, since reports never change. Stored renders SHALL be deleted with their project. A change to how images are drawn SHALL invalidate older stored renders.

#### Scenario: Second request
- **WHEN** an agent asks for the same item's images twice
- **THEN** the second request is answered from the stored images without starting a render
