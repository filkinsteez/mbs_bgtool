// Moodboard tiles in Figma file 9TlfqUvSxIonSEgmcoHFfF (boards 63:658, 63:659, 63:660).
//
// tile: the node size in Figma units.
// fill: how the image fill sits in the tile.
//   { fit: "cover" }  scaled to cover the tile, centered (Figma FILL).
//   { fit: "crop", box: { left, top, width, height } }  the image box as
//     fractions of the tile, as Figma's code output reports it (Figma CROP).
//   rotate: "ccw90" means the tile shows the image turned 90 degrees
//     counterclockwise. Figma's code output drops that rotation; its box
//     numbers still give the visible region of the unrotated image.
// ignore: print or layout marks that are not light, [x, y, w, h] in target pixels.

export const RAW_DIR = "artifacts/references-raw";
export const TARGET_DIR = "public/references/awe";
export const NOTES_DIR = "docs/references/awe";
export const TARGET_WIDTH = 925;
export const FULL_MAX_EDGE = 2400;

export const REFERENCES = [
  {
    id: "sunset-sky-peach",
    mood: "sunset",
    figmaNodeId: "41:14",
    figmaName: "image 39",
    title: "Blue sky to grey-beige, peach, orange and deep red",
    recipe: "sunset.ramp",
    tile: [925, 1001.388916015625],
    fill: { fit: "crop", box: { left: -0.0002, top: 0, width: 1.0004, height: 1.387 } },
    ignore: [],
  },
  {
    id: "sunset-violet-wave",
    mood: "sunset",
    figmaNodeId: "41:31",
    figmaName: "image 58",
    title: "Light blue sky, white-pink glow, wavy violet horizon, indigo below",
    recipe: "sunset.ramp",
    tile: [925, 616.6666870117188],
    fill: { fit: "cover" },
    ignore: [],
  },
  {
    id: "sunset-red-yellow-arcs",
    mood: "sunset",
    figmaNodeId: "41:15",
    figmaName: "image 40",
    title: "Maroon to red, orange, yellow, cream and light blue in wide arcs",
    recipe: "sunset.ramp",
    tile: [925, 1369.7115478515625],
    fill: { fit: "crop", box: { left: -0.1868, top: -0.0798, width: 1.3736, height: 1.1596 } },
    ignore: [{ kind: "text", rect: [0, 1360, 925, 10] }],
  },
  {
    id: "sunset-blue-diagonal",
    mood: "sunset",
    figmaNodeId: "41:22",
    figmaName: "image 41",
    title: "Deep blue top right to lavender and peach-orange bottom left",
    recipe: "sunset.ramp",
    tile: [925, 1214.0625],
    fill: { fit: "cover" },
    ignore: [],
  },
  {
    id: "sunset-film-poster-bands",
    mood: "sunset",
    figmaNodeId: "41:25",
    figmaName: "image 42",
    title: "Film poster: blurred red, black, blue, grey and red bands",
    recipe: "sunset.bands",
    tile: [925, 1295.963623046875],
    fill: { fit: "cover" },
    ignore: [
      { kind: "text", rect: [139, 1086, 668, 75] },
      { kind: "text", rect: [20, 1160, 885, 124] },
    ],
  },
  {
    id: "sunset-green-riso",
    mood: "sunset",
    figmaNodeId: "41:26",
    figmaName: "image 50",
    title: "Riso print: white to green to mustard",
    recipe: "sunset.bands",
    tile: [925.0000022229651, 1447.177164456469],
    fill: { fit: "crop", box: { left: -0.1119, top: -0.0978, width: 1.202, height: 3.761 }, rotate: "ccw90" },
    ignore: [{ kind: "fold", rect: [0, 728, 925, 34] }],
  },
  {
    id: "sunset-blue-riso",
    mood: "sunset",
    figmaNodeId: "41:27",
    figmaName: "image 63",
    title: "Riso print: white to cyan blue, slate navy band, light blue",
    recipe: "sunset.bands",
    tile: [925.0000022229651, 1447.1771644564687],
    fill: { fit: "crop", box: { left: -0.0731, top: -1.3389, width: 1.1462, height: 3.5865 }, rotate: "ccw90" },
    ignore: [{ kind: "fold", rect: [0, 700, 925, 34] }],
  },
  {
    id: "sunset-pink-riso",
    mood: "sunset",
    figmaNodeId: "41:28",
    figmaName: "image 64",
    title: "Riso print: cream to pink, magenta, orange band, magenta, slate purple",
    recipe: "sunset.bands",
    tile: [925.0000022229651, 1447.1771644564687],
    fill: { fit: "crop", box: { left: -0.0712, top: -2.4961, width: 1.1425, height: 3.5748 }, rotate: "ccw90" },
    ignore: [{ kind: "fold", rect: [0, 700, 925, 34] }],
  },
  {
    id: "contour-rim-edge",
    mood: "contour",
    figmaNodeId: "41:21",
    figmaName: "image 47",
    title: "Blue-white rim glow along a rounded edge on black",
    recipe: "contour.rim",
    tile: [925, 1644.1875],
    fill: { fit: "cover" },
    ignore: [],
  },
  {
    id: "contour-yellow-halo",
    mood: "contour",
    figmaNodeId: "41:23",
    figmaName: "image 57",
    title: "Pale yellow cropped halo arc on light to saturated blue",
    recipe: "contour.halo",
    tile: [925, 1308.843505859375],
    fill: { fit: "cover" },
    ignore: [
      { kind: "text", rect: [282, 1019, 362, 260] },
      { kind: "other", rect: [922, 0, 3, 1309] },
    ],
  },
  {
    id: "contour-iridescent-rings",
    mood: "contour",
    figmaNodeId: "41:30",
    figmaName: "image 48",
    title: "Overlapping cropped rings with iridescent rims on near-black",
    recipe: "contour.halo",
    tile: [925, 1233.0240478515625],
    fill: { fit: "cover" },
    ignore: [{ kind: "other", rect: [265, 1070, 350, 163] }],
  },
  {
    id: "contour-radial-streaks",
    mood: "contour",
    figmaNodeId: "41:19",
    figmaName: "image 62",
    title: "Radial blue streaks converging on a bright horizon",
    recipe: "contour.beam",
    tile: [925, 616.6666870117188],
    fill: { fit: "cover" },
    ignore: [],
  },
  {
    id: "contour-beam-pool",
    mood: "contour",
    figmaNodeId: "41:18",
    figmaName: "image 49",
    title: "Vertical beam through haze onto a bright floor pool",
    recipe: "contour.beam",
    tile: [925, 1850],
    fill: { fit: "cover" },
    ignore: [],
  },
  {
    id: "contour-light-line",
    mood: "contour",
    figmaNodeId: "41:20",
    figmaName: "image 51",
    title: "Thin vertical line with a white-yellow core and a warm halo on black",
    recipe: "contour.rim",
    tile: [925, 1643.8858642578125],
    fill: { fit: "cover" },
    ignore: [],
  },
  {
    id: "warp-long-exposure-streaks",
    mood: "warp",
    figmaNodeId: "41:29",
    figmaName: "image 52",
    title: "Long-exposure light streaks with white cores",
    recipe: "warp",
    tile: [925, 1644.5467529296875],
    fill: { fit: "cover" },
    ignore: [],
  },
  {
    id: "warp-refracted-column",
    mood: "warp",
    figmaNodeId: "41:9",
    figmaName: "image 53",
    title: "Refracted column of light with flame-like edges",
    recipe: "warp",
    tile: [925, 1805.2373046875],
    fill: { fit: "crop", box: { left: -0.4995, top: -0.2806, width: 1.9991, height: 1.4159 } },
    ignore: [],
  },
  {
    id: "warp-curved-spectral-bands",
    mood: "warp",
    figmaNodeId: "41:8",
    figmaName: "image 55",
    title: "Wide curved spectral bands",
    recipe: "warp",
    tile: [925, 1156.25],
    fill: { fit: "crop", box: { left: -0.1191, top: -0.2, width: 1.2383, height: 1.4007 } },
    ignore: [],
  },
  {
    id: "warp-film-poster-columns",
    mood: "warp",
    figmaNodeId: "26:486",
    figmaName: "image 28",
    title: "Film poster: soft vertical color columns",
    recipe: "warp",
    tile: [925, 1295],
    fill: { fit: "cover" },
    ignore: [
      { kind: "text", rect: [135, 1085, 667, 74] },
      { kind: "text", rect: [0, 1159, 925, 124] },
    ],
  },
];

export function rawFillPath(ref) {
  return `${RAW_DIR}/${ref.figmaNodeId.replace(":", "-")}-fill.png`;
}

export function rawShotPath(ref) {
  return `${RAW_DIR}/${ref.figmaNodeId.replace(":", "-")}-shot.png`;
}

export function targetFile(ref) {
  return `${ref.mood}/${ref.id}.png`;
}

export function fullFile(ref) {
  return `${ref.mood}/${ref.id}-full.png`;
}

export function targetSize(ref) {
  const [tw, th] = ref.tile;
  return [TARGET_WIDTH, Math.round((th * TARGET_WIDTH) / tw)];
}
