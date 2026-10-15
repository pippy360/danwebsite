# Dan Peacock — The Gallery House

A little house you can walk around in first person, with Dan Peacock's artwork framed on the walls. Built with [three.js](https://threejs.org/) and [Vite](https://vite.dev/).

- Start in the front garden and walk in through the front door
- Six rooms: Entrance Hall, Living Room, The Long Gallery, Library, Garden Room and Studio
- Every work gets a frame, a mat, a brass picture light and a soft shadow on the wall
- Click (or tap) a painting to see it full size, with its title, caption and a link to the Instagram post
- Works on phones (touch joystick) and has a plain grid view for anyone who'd rather not walk around
- No image assets needed for the house itself: floors, brick, slate and lawn are all generated in code

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
```

Until you add real images, the walls show 30 generated placeholder paintings.

## Adding Dan's art

1. **Put the images in `public/art/`** (JPG, PNG, WebP, GIF or AVIF; one level of subfolders is fine).
   The originals from Dan will look better than Instagram downloads, which are compressed to about 1080 px.
2. **Run the manifest script:**
   ```bash
   npm run art
   ```
   This creates or updates `public/art/art.json`. It reads each image's dimensions so frames get the right shape, guesses a title from the filename, and keeps any details you've already filled in. Run it again whenever you add or remove images.
3. **Edit `public/art/art.json`** to add titles, captions and Instagram links:

```json
{
  "artist": "Dan Peacock",
  "tagline": "Paintings, drawings & other things",
  "instagram": "https://www.instagram.com/DANS_HANDLE/",
  "works": [
    {
      "file": "blue-heron.jpg",
      "title": "Blue Heron",
      "year": "2024",
      "medium": "Gouache on paper",
      "caption": "Painted on a grey morning by the canal.",
      "instagram": "https://www.instagram.com/p/POST_ID/",
      "featured": true,
      "width": 1080,
      "height": 1350
    }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `artist`, `tagline` | Shown on the welcome card, the plaque by the front door and the lettering in the entrance hall |
| `instagram` (top level) | Dan's profile, linked from the welcome card and used for any work without its own link |
| `file` | Path inside `public/art/` |
| `title`, `year`, `medium`, `caption` | Shown in the viewer when you click a painting |
| `instagram` (per work) | Link to that post, shown as **View on Instagram** |
| `featured` | Featured works hang large on the two end walls of the Long Gallery |
| `frame` | Optional: `black`, `oak`, `walnut`, `white` or `gold` (otherwise picked automatically) |
| `mat` | Optional: set to `false` to frame without a mat |
| `width`, `height` | Filled in by `npm run art` |

**Order matters:** works are hung in the order they appear in `works`, following a walking tour: Entrance Hall → Living Room → Long Gallery → Library → Garden Room → Studio. The layout adapts to any number of works. Bigger collections get smaller frames and then salon-style double or triple rows.

> **Why not pull straight from Instagram?** Instagram blocks scraping and only lets approved apps with access tokens read posts, so the reliable way is to save the images (with Dan's blessing!) into `public/art/`. Each work can still link back to its post.

## Controls

| | Desktop | Phone / tablet |
| --- | --- | --- |
| Walk | `W` `A` `S` `D` / arrow keys | Left thumb (floating joystick) |
| Look | Mouse | Drag anywhere else |
| Run | `Shift` | Push the joystick to the edge |
| View a painting | Click (or `E`) | Tap it |
| Browse as a grid | `G` | ☰ menu |
| Pause | `Esc` | ☰ menu |

In the painting viewer: `←` / `→` (or swipe) to browse, **Walk to this painting** to jump in front of it, and `Esc` to close.

## Building & hosting

```bash
npm run build      # outputs a static site to dist/
npm run preview    # serve the production build locally
```

`dist/` is plain static files with relative paths, so it works on GitHub Pages (including the `/danwebsite/` sub-path), Netlify, Vercel, Cloudflare Pages or any web server.

## Customising the house

- **Layout:** `src/world/floorplan.js` defines the rooms, walls, doors and windows, plus each room's floor, paint colour, lights and which walls take art. The house shell, art layout and collisions are all generated from it.
- **Furniture:** `src/world/furniture.js`
- **Garden, sky & trees:** `src/world/outdoors.js`
- **Lighting:** `src/world/lighting.js`
- **Frames & picture lights:** `src/gallery/frames.js`
- **Hanging rules:** `src/gallery/layout.js`

Debug helpers: append `?view=x,z,yawDegrees,pitchDegrees` to the URL to jump straight to a viewpoint with no overlays (handy for screenshots), and `?quality=low|high` to force a quality level.

## Project structure

```
index.html                 page shell (welcome card, HUD, viewer, grid)
public/art/                Dan's images + art.json
scripts/build-art-manifest.mjs   generates art.json (npm run art)
src/main.js                bootstraps everything, state machine, picking
src/world/                 floor plan, house builder, textures, furniture, garden, lighting, signs
src/gallery/               manifest loading, wall layout, frames, placeholder art
src/player/                first-person controller + touch controls
src/ui/ui.js               overlays, lightbox, grid view
```