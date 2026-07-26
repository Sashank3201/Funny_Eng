/**
 * Every word on the page.
 *
 * This is the only file to edit when the content changes — nothing else in the
 * project hardcodes copy. Anything still marked TODO is a placeholder, and the
 * page says so in the corner for as long as any remain.
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
  /**
   * Marks a demonstration entry rather than real work. Renders a visible
   * "Example" tag — a portfolio that passes invented projects off as real is
   * worse than one that is visibly unfinished.
   */
  example?: boolean;
}

export interface SkillGroup {
  label: string;
  items: string[];
}

export const content = {
  /** Document-level metadata. */
  meta: {
    name: 'Sashank',
    role: 'Cyber Security Analyst',
    description:
      'Sashank — cyber security analyst working on systems and their security. Available for work.',
  },

  /** Shown as a live status chip in the header. Set to null to hide it. */
  availability: 'Available for work',

  hero: {
    eyebrow: 'Cyber Security Analyst',
    headline: 'Sashank',
    standfirst:
      'I work on systems, and on how they hold up when someone goes looking for the weak points.',
    actions: [
      { label: 'See the work', href: '#work', primary: true },
      { label: 'Get in touch', href: '#contact', primary: false },
    ],
  },

  work: {
    label: 'Selected work',
    intro:
      'Example entries, shown to lay out the section. Real projects replace them shortly.',
    projects: [
      {
        title: 'Network intrusion detection pipeline',
        period: '2025',
        role: 'Example entry',
        summary:
          'Ingests network flow logs, baselines normal traffic, and raises alerts on patterns that deviate from it.',
        stack: ['Python', 'Suricata', 'Elasticsearch', 'Kibana'],
        links: [],
        example: true,
      },
      {
        title: 'Web application security assessment',
        period: '2024',
        role: 'Example entry',
        summary:
          'Black-box assessment of an internal web application, covering authentication, access control and injection surfaces, written up with reproduction steps and fixes.',
        stack: ['Burp Suite', 'OWASP ZAP', 'Python'],
        links: [],
        example: true,
      },
      {
        title: 'Phishing simulation programme',
        period: '2024',
        role: 'Example entry',
        summary:
          'Ran controlled phishing campaigns against a consenting internal group and tracked how reporting rates changed with training.',
        stack: ['GoPhish', 'Python', 'Postfix'],
        links: [],
        example: true,
      },
    ] as Project[],
  },

  about: {
    label: 'About',
    paragraphs: [
      'I work on systems and their security — how they are put together, where they are weak, and what happens when someone goes looking for those weaknesses.',
      'TODO — background: how you got here, what you studied, what you are looking for next.',
    ],
    skills: [
      { label: 'Languages', items: ['TODO'] },
      { label: 'Security', items: ['TODO'] },
      { label: 'Tools', items: ['TODO'] },
    ] as SkillGroup[],
  },

  contact: {
    label: 'Contact',
    headline: 'Available for work — say hello.',
    email: 'sashank3301@gmail.com',
    socials: [
      { label: 'GitHub', href: 'https://github.com/Sashank3201' },
      // LinkedIn intentionally omitted until there is a real URL. A link
      // pointing nowhere is worse than no link.
    ],
  },

  /**
   * Live annotations over the simulation. These are the real numbers the
   * renderer is integrating, not decoration.
   */
  readout: {
    label: 'Schwarzschild black hole',
    lines: ['Null geodesics integrated per pixel', 'd²u/dφ² = 3Mu² − u'],
  },
} as const;

/** Recursively true if any string anywhere still carries a TODO marker. */
function hasTodo(value: unknown): boolean {
  if (typeof value === 'string') return value.includes('TODO');
  if (Array.isArray(value)) return value.some(hasTodo);
  if (value && typeof value === 'object') return Object.values(value).some(hasTodo);
  return false;
}

/** True while any copy is unfinished, or any project is still an example. */
export const contentIsPlaceholder =
  hasTodo(content) || content.work.projects.some((p) => p.example);
