import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    fileParallelism: false,
    // generous on purpose: staff-account tests run several scrypt hashes and each file cold-boots the whole server
    // (~10 s alone); on a busy machine both run 3-5x slower, and a timeout there is noise, not a regression
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
})
