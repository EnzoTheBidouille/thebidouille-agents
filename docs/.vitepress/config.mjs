import { defineConfig } from 'vitepress'

// Deployed to GitHub Pages at https://thebidouilleagency.github.io/cohorte/
// by .github/workflows/docs.yml — `base` must match the repo name.
export default defineConfig({
  title: 'cohorte',
  description:
    'Portable, stack-agnostic multi-agent development pipeline for Claude Code — install the core, run /init-pipeline, and it adapts to your project.',
  base: '/cohorte/',
  lastUpdated: true,
  head: [['link', { rel: 'icon', type: 'image/png', href: '/cohorte/favicon-32.png' }]],

  themeConfig: {
    logo: '/cohorte-mark.svg',

    nav: [
      { text: 'Guide', link: '/guide/what-is-cohorte' },
      { text: 'Reference', link: '/reference/commands' },
      {
        text: 'Changelog',
        link: 'https://github.com/TheBidouilleAgency/cohorte/blob/main/CHANGELOG.md',
      },
    ],

    sidebar: {
      '/guide/': [
        {
          text: 'Introduction',
          items: [
            { text: 'What is cohorte?', link: '/guide/what-is-cohorte' },
            { text: 'Getting started', link: '/guide/getting-started' },
          ],
        },
        {
          text: 'Using the pipeline',
          items: [
            { text: 'The feature cycle', link: '/guide/feature-cycle' },
            { text: 'Workflows (multi-agent runs)', link: '/guide/workflows' },
            { text: 'Token economy', link: '/guide/token-economy' },
            { text: 'Parallel features', link: '/guide/parallel-features' },
          ],
        },
        {
          text: 'Capabilities',
          items: [
            { text: 'Design system', link: '/guide/design-system' },
            { text: 'Kanban mirror', link: '/guide/kanban' },
            { text: 'Dashboard', link: '/guide/dashboard' },
          ],
        },
      ],
      '/reference/': [
        {
          text: 'Reference',
          items: [
            { text: 'Commands', link: '/reference/commands' },
            { text: 'Agents', link: '/reference/agents' },
            { text: 'The profile (PIPELINE.md)', link: '/reference/profile' },
            { text: 'Gate & permissions', link: '/reference/gate' },
            { text: 'Shipped scripts', link: '/reference/scripts' },
            { text: 'Installers & updates', link: '/reference/installers' },
            { text: 'Telemetry & privacy', link: '/reference/telemetry' },
            { text: 'Troubleshooting', link: '/reference/troubleshooting' },
          ],
        },
      ],
    },

    socialLinks: [{ icon: 'github', link: 'https://github.com/TheBidouilleAgency/cohorte' }],

    search: { provider: 'local' },

    outline: { level: [2, 3] },

    footer: {
      message: 'Released under the AGPL-3.0 license.',
      copyright: 'The Bidouille Agency',
    },

    editLink: {
      pattern: 'https://github.com/TheBidouilleAgency/cohorte/edit/main/docs/:path',
      text: 'Edit this page on GitHub',
    },
  },
})
