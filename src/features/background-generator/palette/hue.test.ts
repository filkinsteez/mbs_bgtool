import { describe, expect, it } from 'vitest'
import { groupColorsByHue } from './hue'

describe('material hue groups', () => {
  it('anchors at blue and orders chromatic groups by circular hue distance', () => {
    const colors = [
      '#FFFF00',
      '#FF00FF',
      '#00FF00',
      '#FFFFFF',
      '#FF8000',
      '#00FFFF',
      '#FF0000',
      '#8000FF',
      '#0000FF',
    ]
    const expected = [
      'blue',
      'cyan',
      'purple',
      'magenta',
      'green',
      'red',
      'orange',
      'yellow',
      'neutral',
    ]

    expect(groupColorsByHue(colors).map((group) => group.id)).toEqual(expected)
    expect(groupColorsByHue([...colors].reverse()).map((group) => group.id)).toEqual(expected)
  })

  it('keeps nearest available groups in blue-anchored order', () => {
    const groups = groupColorsByHue([
      '#0064E0',
      '#FFFFFF',
      '#FF5001',
      '#AE4FC3',
      '#26C8EE',
      '#FED61F',
    ])
    expect(groups.map((group) => group.id)).toEqual([
      'blue',
      'cyan',
      'purple',
      'orange',
      'yellow',
      'neutral',
    ])
  })

  it('sorts chromatic swatches from low to high saturation with perceptual tie-breakers', () => {
    const blue = groupColorsByHue([
      '#3399FF',
      '#333399',
      '#80A0C0',
      '#3a6998',
      '#6666CC',
      '#7890A8',
      '#3A6998',
      '#336699',
      '#6699CC',
    ]).find((group) => group.id === 'blue')

    expect(blue?.colors).toEqual([
      '#7890A8',
      '#80A0C0',
      '#3a6998',
      '#3A6998',
      '#6699CC',
      '#6666CC',
      '#336699',
      '#333399',
      '#3399FF',
    ])
  })

  it('orders zero-saturation neutrals by lightness before source order', () => {
    const groups = groupColorsByHue(['#8B9BAA', '#000000', '#FFFFFF', '#808080'])
    expect(groups).toEqual([{
      id: 'neutral',
      label: 'Neutrals',
      colors: ['#FFFFFF', '#808080', '#000000', '#8B9BAA'],
    }])
  })
})
