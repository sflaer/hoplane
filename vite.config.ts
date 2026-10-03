import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { createGithubAgent } from './server/github-agent.mjs'

function githubPlugin(): Plugin {
  return {
    name: 'vibedeploy-local-agent',
    configureServer(server) {
      const agent = createGithubAgent({ root: server.config.root })
      server.middlewares.use(agent.middleware)
    },
  }
}

export default defineConfig({ plugins: [react(), githubPlugin()] })
