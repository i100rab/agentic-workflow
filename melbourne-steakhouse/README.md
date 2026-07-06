# Ironbark Steakhouse

A static marketing site for a fictional Melbourne CBD wood-fired steakhouse. No build step, no framework — plain HTML/CSS/JS so it loads fast on any device.

## Preview locally

```
cd melbourne-steakhouse
python3 -m http.server 8080
```

Then open `http://localhost:8080/index.html`.

## Structure

- `index.html`, `menu.html`, `about.html`, `gallery.html`, `reservations.html`, `contact.html` — pages, each duplicating the shared header/footer markup (no build tool, no templating)
- `css/style.css` — design tokens (color, type, spacing) and all component styles
- `js/main.js` — mobile nav toggle, sticky header, scroll-reveal (with a print/no-JS/timeout fallback so content is never hidden), static form submit handling

## What's placeholder vs. real

- Brand name, menu, copy, chef bio, and address are invented for this brief.
- `gallery.html` and the texture panels throughout use CSS/SVG textures in place of photography — swap `.texture-panel` divs for real `<img>`s once a shoot is done; captions are already written for that shoot.
- The reservation and contact forms are front-end only (`data-static-form` in `js/main.js` intercepts submit and shows a success message). Wire them to a real backend or email service before launch.
