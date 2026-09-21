import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        accent: {
          DEFAULT: 'var(--accent)',
          hover: 'var(--accent-hover)',
          muted: 'var(--accent-muted)',
          subtle: 'var(--accent-subtle)',
        },
      },
      backgroundColor: {
        'app': 'var(--bg-app)',
        'surface': 'var(--bg-surface)',
        'elevated': 'var(--bg-elevated)',
        'hover': 'var(--bg-hover)',
        'active': 'var(--bg-active)',
        'muted': 'var(--bg-muted)',
        'inset': 'var(--bg-inset)',
      },
      borderColor: {
        'subtle': 'var(--border-subtle)',
        'default': 'var(--border-default)',
        'strong': 'var(--border-strong)',
        'accent': 'var(--accent)',
      },
      textColor: {
        'primary': 'var(--text-primary)',
        'secondary': 'var(--text-secondary)',
        'tertiary': 'var(--text-tertiary)',
        'accent': 'var(--accent)',
      },
      /*
       * The type scale.
       *
       * There were thirty-one sizes before this: twenty-five arbitrary
       * bracket values plus six Tailwind defaults, with NINE of them
       * living between 9px and 13.5px and every one used hundreds of
       * times. 11px, 11.5px, 12px and 12.5px are not four sizes - they
       * are one size that nobody agreed on, and they are why things in
       * this app looked almost aligned and never settled.
       *
       * Eight steps, named by role. Every value here was already one of
       * the dominant sizes in the codebase, so collapsing onto them moves
       * almost nothing visually - it just stops the drift.
       *
       * FONT SIZE ONLY, deliberately. `text-[12px]` sets font-size and
       * leaves line-height to inherit; attaching a line-height to these
       * tokens would silently change the leading of sixteen hundred
       * places at once, which is a different change and not this one.
       */
      fontSize: {
        /** Chips, badges, uppercase labels. */
        micro:   ['10px'],
        /** Secondary and tertiary text, hints, captions. */
        caption: ['11px'],
        /** Default UI text. */
        body:    ['12px'],
        /** Row titles, emphasis, buttons. */
        strong:  ['13px'],
        /** Panel and section headings. */
        heading: ['15px'],
        /** Page titles. */
        title:   ['19px'],
        /** Large figures on a card. */
        display: ['22px'],
        /** The one number a screen is about. */
        hero:    ['28px'],
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Consolas', 'monospace'],
      },
      fontSize: {
        'display-xl': ['4.5rem', { lineHeight: '1', letterSpacing: '-0.03em', fontWeight: '600' }],
        'display-lg': ['3.75rem', { lineHeight: '1.05', letterSpacing: '-0.025em', fontWeight: '600' }],
        'display': ['3rem', { lineHeight: '1.1', letterSpacing: '-0.02em', fontWeight: '600' }],
        'heading-lg': ['2rem', { lineHeight: '1.2', letterSpacing: '-0.02em', fontWeight: '600' }],
        'heading': ['1.5rem', { lineHeight: '1.3', letterSpacing: '-0.015em', fontWeight: '600' }],
        'heading-sm': ['1.125rem', { lineHeight: '1.4', letterSpacing: '-0.01em', fontWeight: '600' }],
      },
      boxShadow: {
        'sm': 'var(--shadow-sm)',
        'md': 'var(--shadow-md)',
        'lg': 'var(--shadow-lg)',
        'xl': 'var(--shadow-xl)',
        'card': 'var(--shadow-card)',
        'card-hover': 'var(--shadow-card-hover)',
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-out',
        'fade-up': 'fadeUp 0.5s ease-out forwards',
        'fade-up-delay-1': 'fadeUp 0.5s ease-out 0.1s forwards',
        'fade-up-delay-2': 'fadeUp 0.5s ease-out 0.2s forwards',
        'fade-up-delay-3': 'fadeUp 0.5s ease-out 0.3s forwards',
        'slide-up': 'slideUp 0.3s ease-out',
        'slide-down': 'slideDown 0.3s ease-out',
        'slide-in-right': 'slideInRight 0.3s ease-out',
        'marquee': 'marquee 40s linear infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        fadeUp: {
          '0%': { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideDown: {
          '0%': { opacity: '0', transform: 'translateY(-8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideInRight: {
          '0%': { opacity: '0', transform: 'translateX(8px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        marquee: {
          '0%': { transform: 'translateX(0%)' },
          '100%': { transform: 'translateX(-50%)' },
        },
      },
      backgroundImage: {
        'noise': 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 256 256\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'noise\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.65\' numOctaves=\'3\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23noise)\' opacity=\'0.03\'/%3E%3C/svg%3E")',
      },
      borderRadius: {
        'xl': '12px',
        '2xl': '16px',
        '3xl': '24px',
      },
      transitionDuration: {
        '250': '250ms',
      },
    },
  },
  plugins: [],
};

export default config;
