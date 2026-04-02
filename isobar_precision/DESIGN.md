# Design System Document: The Precision Observer

## 1. Overview & Creative North Star
**Creative North Star: "The Synthetic Horizon"**

This design system is engineered to transform complex meteorological telemetry into an authoritative, cinematic experience. We are moving away from the "cluttered dashboard" trope of traditional GIS tools toward a **Synthetic Horizon**—a methodology where data feels projected rather than printed. 

To achieve a high-end, editorial feel for scientific data, the design system rejects the "standard" boxy UI. We utilize **intentional asymmetry**, where heavy data tables are balanced by expansive, airy map views. We break the grid by allowing map overlays to "bleed" into UI containers using glassmorphism, creating a seamless integration between the earth's surface and the analytical interface. The result is a tool that feels less like a spreadsheet and more like a tactical mission control center.

---

## 2. Colors
Our palette is rooted in the deep obsidian of the night sky (`surface: #0b1326`), providing a high-contrast foundation that makes scientific data "pop" with neon-like clarity.

### The "No-Line" Rule
**Borders are a design failure.** To maintain a premium, modern aesthetic, designers are prohibited from using 1px solid borders to section off content. Instead, structural boundaries must be defined through:
- **Background Shifts:** Use `surface_container_low` against `surface` to define a sidebar.
- **Tonal Transitions:** A `surface_container_highest` header sitting on a `surface_container` body.

### Surface Hierarchy & Nesting
Treat the UI as physical layers of data. 
- **Base Layer:** `surface` (The foundation).
- **Secondary Containers:** `surface_container_low` for non-interactive backgrounds.
- **Active Data Cards:** `surface_container_high` to pull critical fire-risk metrics forward.
- **Nesting:** Always move from darker to lighter as you nest inward to simulate a "glow" from the data source.

### The "Glass & Gradient" Rule
For floating map controls and weather overlays, use **Glassmorphism**. Apply `surface_variant` at 60% opacity with a `20px` backdrop blur. 
- **Signature Textures:** For high-alert fire zones or primary CTAs, use a linear gradient from `primary` (#7bd0ff) to `on_primary_container` (#008abb) at a 135-degree angle. This adds "visual soul" and depth that flat hex codes cannot replicate.

---

## 3. Typography
We use a high-contrast dual-font strategy to balance scientific rigor with editorial authority.

*   **Display & Headlines (Space Grotesk):** A tech-forward, wide-aperture typeface used for large metrics and section headers. It feels mechanical yet sophisticated.
    *   `display-lg` (3.5rem): Reserved for critical risk percentages.
    *   `headline-sm` (1.5rem): Used for primary map locations.
*   **Body & Labels (Inter):** A hyper-legible workhorse for data tables and coordinate systems. 
    *   `label-md` (0.75rem): Used for map labels and sensor timestamps.
    *   `body-md` (0.875rem): Standard for long-form weather reports.

The hierarchy is designed to be "scannable under stress." Large headlines tell the user *what* is happening; tiny, high-contrast labels provide the *scientific proof*.

---

## 4. Elevation & Depth
In a data-centric application, traditional shadows can muddy the clarity of a map. We use **Tonal Layering** and **Atmospheric Perspective**.

*   **The Layering Principle:** Rather than shadows, stack the containers. A `surface_container_lowest` card placed atop a `surface_container_high` panel creates a "sunken" or "embedded" feel, perfect for input fields.
*   **Ambient Shadows:** For floating modals (e.g., a detailed fire-risk report), use a wide-spread shadow: `0px 20px 40px rgba(6, 14, 32, 0.4)`. The shadow color is derived from `surface_container_lowest` to ensure it feels like a natural occlusion of light.
*   **The Ghost Border Fallback:** If a boundary is strictly required for accessibility, use `outline_variant` at **15% opacity**. It should be felt, not seen.
*   **Depth through Blur:** Use heavy backdrop blurs on any element sitting over the map. This maintains the "Synthetic Horizon" look, ensuring the map feels like it exists behind the UI, not just under it.

---

## 5. Components

### Buttons & Inputs
*   **Primary Buttons:** Use the signature `primary` to `on_primary_container` gradient. Use `roundedness-sm` (0.125rem) for a sharp, precision-tool look.
*   **Input Fields:** No borders. Use `surface_container_highest` with a bottom-only "active" line in `primary` (#7bd0ff).

### Chips & Risk Indicators
*   **Risk Chips:** Follow the meteorological spectrum.
    *   *Safe:* `secondary` (#4ae176) text on `secondary_container`.
    *   *Extreme:* `tertiary` (#fbabff) text on `tertiary_container`.
*   **Style:** Use `full` roundedness for chips to contrast against the sharp `md` (0.375rem) roundedness of the main data panels.

### Data Tables & Cards
*   **Forbid Dividers:** Do not use lines between rows. Use `0.5rem` (spacing-2.5) of vertical white space and a subtle background alternate (zebra striping) using `surface_container_low` and `surface_container`.
*   **Map Tooltips:** Must use the glassmorphism rule. `surface_variant` + `backdrop-blur`.

### Specialized GIS Components
*   **The Timeline Scrubber:** A custom component using a `primary` track with `primary_fixed_dim` thumb. The background should be `surface_container_lowest` to appear recessed into the map.
*   **Layer Toggle:** Use `on_surface_variant` for inactive states and `primary` for active states. Use `spacing-1` (0.2rem) for tight, technical spacing between elements.

---

## 6. Do's and Don'ts

### Do
*   **Do** use `spaceGrotesk` for all numerical data points to enhance the "instrumentation" feel.
*   **Do** use `spacing-20` and `spacing-24` to create massive "breathing rooms" between high-level summaries and granular data tables.
*   **Do** align all map controls to the right to maintain an asymmetrical, editorial layout.

### Don't
*   **Don't** use 100% opaque black for any background; always use the deep navy `surface` (#0b1326).
*   **Don't** use standard "drop shadows" on cards; use tonal shifts between `surface_container` tiers.
*   **Don't** use "Alert Red" for fire risk unless it is an error state. Use the `tertiary` (#fbabff) and `tertiary_fixed` (#ffd6fd) purples/pinks for scientific fire-risk accuracy.