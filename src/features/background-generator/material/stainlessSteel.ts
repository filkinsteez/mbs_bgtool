/**
 * Authoritative values returned by the Shaders MCP `get-preset` export for
 * a92be03a-7df7-4f54-91f3-a87ba40bd320 (React format).
 *
 * Runtime adaptations replace the preset logo SDF with the local Meta symbol,
 * map the two explicit material colors, and preserve the editor transform.
 */
export const STAINLESS_STEEL_PRESET = {
  id: 'a92be03a-7df7-4f54-91f3-a87ba40bd320',
  mcpTitle: 'Stainless Steel',
  displayLabel: 'Stainless Steel 1',
  source: {
    studioBackground: {
      ambientIntensity: 65,
      backIntensity: 25,
      brightness: 100,
      center: { x: 0.5, y: 0.88 },
      color: '#1b1b21',
      fillAngle: 53,
      fillIntensity: 9,
      fillSoftness: 94,
      keyIntensity: 11,
      keySoftness: 100,
      wallCurvature: 19,
    },
    glass: {
      aberration: 1,
      blur: 20,
      cutout: true,
      fresnel: 0.02,
      fresnelSoftness: 0.31,
      highlight: 0.3,
      refraction: 1.57,
      shapeSdfUrl: 'https://data.shaders.com/storage/v1/object/public/user-uploaded-images/user_33nh0FG48zZa0rIUZuK7vgwPfZe/_anekeNfTTiN_sdf.bin',
      thickness: 1,
    },
    swirl: {
      blend: 18,
      colorA: '#141412',
      colorB: '#ffffff',
      colorSpace: 'hsl',
      detail: 4.2,
      speed: 0.5,
    },
    filmGrain: {
      strength: 0.1,
    },
  },
} as const
