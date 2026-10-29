import { describe, expect, it } from 'vitest'
import type { ConfigEnv, UserConfig } from 'vite'
import viteConfig from '../../../vite.config'

// GitHub Pages serves Loom from https://rishirajani.github.io/loom/, so every
// production asset URL must be prefixed with /loom/. Without `base`, the built
// index.html requests /assets/… from the domain root, which 404s and leaves a
// blank page. That happened once: the setting was dropped during an unrelated
// vite.config.ts edit and nothing failed until someone opened the site.
function resolve(env: ConfigEnv): UserConfig {
  if (typeof viteConfig !== 'function') {
    throw new Error('vite.config.ts is expected to export a config function')
  }
  return viteConfig(env) as UserConfig
}

describe('vite config', () => {
  it('builds with the /loom/ base path GitHub Pages needs', () => {
    expect(resolve({ command: 'build', mode: 'production' }).base).toBe('/loom/')
  })

  it('previews the build under /loom/ too, matching the built asset URLs', () => {
    expect(resolve({ command: 'serve', mode: 'production', isPreview: true }).base).toBe('/loom/')
  })

  it('serves from / in dev so localhost works without a path', () => {
    expect(resolve({ command: 'serve', mode: 'development' }).base).toBe('/')
  })
})
