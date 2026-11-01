# Zors Bot Uniform Class Square Prompt

Copy the complete prompt below into ChatGPT image generation.

The goal is to create all nine class markers as custom Discord emojis so every
colored square has exactly the same size, shape, padding, and corner radius.

## Prompt

```text
Create a complete set of nine uniform solid-color square markers for a Discord
raid roster named Zors Bot.

These are minimal color markers only. They are not class emblems or illustrated
icons.

Create nine separate static PNG files:

1. zors_class_druid.png
   Color: #FF7D0A

2. zors_class_hunter.png
   Color: #ABD473

3. zors_class_mage.png
   Color: #69CCF0

4. zors_class_paladin.png
   Color: #F58CBA

5. zors_class_priest.png
   Color: #FFFFFF

6. zors_class_rogue.png
   Color: #FFF569

7. zors_class_shaman.png
   Color: #0070DE

8. zors_class_warlock.png
   Color: #9482C9

9. zors_class_warrior.png
   Color: #C79C6E

Every file must follow exactly the same production template:

- 1024 × 1024 pixel canvas.
- PNG format.
- Genuinely transparent background.
- Exactly one centered solid-color square.
- The square occupies exactly 82% of the canvas width and height.
- Equal transparent padding on the top, bottom, left, and right.
- Exactly the same square dimensions in all nine files.
- Exactly the same corner radius in all nine files.
- Use a subtle 7% corner radius so the shape resembles a polished Discord
  colored-square emoji while remaining unmistakably square.
- Fill the entire square with the class's exact hexadecimal color.
- Use one completely flat and uniform color.
- No color variation between the center and edges.
- No antialiasing differences between files except what is required for the
  identical rounded corners.

Do not include:

- class symbols;
- fantasy glyphs;
- weapons;
- shields;
- animals;
- letters;
- numbers;
- text;
- logos;
- borders;
- outlines;
- bevels;
- gradients;
- highlights;
- lighting;
- textures;
- patterns;
- glow;
- shadows;
- scenery;
- watermarks;
- circles;
- hearts;
- badges;
- sprite sheets;
- contact sheets;
- mockups;
- multiple squares inside one image.

The nine assets must differ only by their fill color and filename. Their
geometry, canvas size, transparent padding, alignment, corner radius, edge
quality, and apparent Discord display size must be identical.

Do not combine the markers into one image. Deliver nine separate downloadable
PNG files. If the interface can generate only one image at a time, generate
them sequentially in the listed order while keeping the exact same locked
geometry for every file.

Before delivering the files, compare all nine and verify that overlaying them
would produce perfectly aligned square edges and corners.
```

## Expected files

```text
zors_class_druid.png
zors_class_hunter.png
zors_class_mage.png
zors_class_paladin.png
zors_class_priest.png
zors_class_rogue.png
zors_class_shaman.png
zors_class_warlock.png
zors_class_warrior.png
```

## Delivery checklist

- [ ] Nine separate PNG files were provided.
- [ ] Every canvas is 1024 × 1024.
- [ ] Every background is genuinely transparent.
- [ ] Every image contains only one solid square.
- [ ] Every square uses its requested exact hex color.
- [ ] Square dimensions are identical across all nine files.
- [ ] Transparent padding is identical across all nine files.
- [ ] Corner radius is identical across all nine files.
- [ ] There are no symbols, text, gradients, borders, shadows, or decorations.
- [ ] The files are not combined into a sprite sheet or contact sheet.
- [ ] Filenames exactly match the requested names.

After the nine files are returned, Zors Bot can resize and optimize them,
upload them as Discord custom emojis, save their immutable emoji IDs, and
replace every current class marker with the uniform custom set. Attendance
status indicators and all other roster icons will remain unchanged.
