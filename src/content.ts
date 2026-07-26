/**
 * Every word on the page.
 *
 * This is the only file to edit when the content changes — nothing else in the
 * project hardcodes copy. Anything still marked TODO is a placeholder and will
 * look like one on the page, deliberately: a portfolio with invented projects
 * in it is worse than one that is visibly unfinished.
 */

export interface Project {
  /** Short project name. */
  title: string;
  /** Year or range, e.g. "2024" or "2023 — now". */
  period: string;
  /** Your role on it. */
  role: string;
  /** One or two sentences: what it does and why it mattered. */
  summary: string;
  /** Technologies, in the order you'd want them read. */
  stack: string[];
  /** Optional outcome worth stating as a number. */
  metric?: string;
  /** Optional links. */
  links?: { label: string; href: string }[];
}

export interface SkillGroup {
  label: string;
  items: string[];
}

export const content = {
  /** Document-level metadata. */
  meta: {
    name: 'TODO — your name',
    role: 'TODO — your role',
    /** Used for <title> and the meta description. */
    description: 'TODO — one sentence describing what you do.',
  },

  hero: {
    eyebrow: 'TODO — role',
    /** The single <h1>. Keep it to your name. */
    headline: 'TODO — your name',
    /** One or two lines. Concrete beats clever. */
    standfirst: 'TODO — one or two lines on what you build and who for.',
    actions: [
      { label: 'See the work', href: '#work', primary: true },
      { label: 'Get in touch', href: '#contact', primary: false },
    ],
  },

  work: {
    label: 'Selected work',
    intro: 'TODO — one line framing the projects below.',
    projects: [
      {
        title: 'TODO — project name',
        period: '2025',
        role: 'TODO — your role',
        summary: 'TODO — what it does, and what changed because it exists.',
        stack: ['TODO', 'TODO'],
        metric: undefined,
        links: [],
      },
      {
        title: 'TODO — project name',
        period: '2024',
        role: 'TODO — your role',
        summary: 'TODO — what it does, and what changed because it exists.',
        stack: ['TODO', 'TODO'],
        metric: undefined,
        links: [],
      },
      {
        title: 'TODO — project name',
        period: '2024',
        role: 'TODO — your role',
        summary: 'TODO — what it does, and what changed because it exists.',
        stack: ['TODO', 'TODO'],
        metric: undefined,
        links: [],
      },
    ] as Project[],
  },

  about: {
    label: 'About',
    paragraphs: [
      'TODO — what you work on, and how you approach it.',
      'TODO — background, or what you are looking for next.',
    ],
    skills: [
      { label: 'Languages', items: ['TODO'] },
      { label: 'Frameworks', items: ['TODO'] },
      { label: 'Tools', items: ['TODO'] },
    ] as SkillGroup[],
  },

  contact: {
    label: 'Contact',
    headline: 'TODO — a short invitation to get in touch.',
    email: 'todo@example.com',
    socials: [
      { label: 'GitHub', href: 'https://github.com/Sashank3201' },
      { label: 'LinkedIn', href: '#' },
    ],
  },

  /**
   * Live annotations over the simulation. These are the real numbers the
   * renderer is integrating, not decoration.
   */
  readout: {
    label: 'Schwarzschild black hole',
    lines: [
      'Null geodesics integrated per pixel',
      'd²u/dφ² = 3Mu² − u',
    ],
  },
} as const;

/** True while the content is still placeholder, so the page can say so. */
export const contentIsPlaceholder = content.meta.name.startsWith('TODO');
