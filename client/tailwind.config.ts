import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      /*
       * The hues, retuned.
       *
       * These replace Tailwind's own scales of the same names, which is
       * deliberate: amber, emerald and rose alone are written some fifteen
       * hundred times across the app, and at Tailwind's saturation they
       * made every status chip, dot and icon read as a traffic light.
       * Same eleven steps, same lightness ladder - so text-emerald-600 is
       * still readable on white and bg-emerald-50 is still a whisper - at
       * the chroma of ink and pigment rather than of a screen.
       *
       * indigo is the brand ink (see --indigo in index.css); violet and
       * purple are plum; sky and blue are a slate blue; emerald and green
       * are moss; amber is ochre; rose and red are brick.
       */
      colors: {
        indigo: {
          50: '#F1F2FA', 100: '#E1E4F4', 200: '#C5CAEA', 300: '#9EA6DA', 400: '#7380C7',
          500: '#4F5EB5', 600: '#3B4AA3', 700: '#2F3C8A', 800: '#283270', 900: '#242C5B', 950: '#161A36',
        },
        violet: {
          50: '#F6F2F9', 100: '#EBE2F2', 200: '#D8C7E6', 300: '#BDA2D4', 400: '#9F7DBF',
          500: '#8461A8', 600: '#6E4E8E', 700: '#5A4074', 800: '#4A365F', 900: '#3E2F4F', 950: '#251B31',
        },
        purple: {
          50: '#F6F2F9', 100: '#EBE2F2', 200: '#D8C7E6', 300: '#BDA2D4', 400: '#9F7DBF',
          500: '#8461A8', 600: '#6E4E8E', 700: '#5A4074', 800: '#4A365F', 900: '#3E2F4F', 950: '#251B31',
        },
        sky: {
          50: '#F1F5F9', 100: '#DFE8F1', 200: '#C1D3E5', 300: '#96B5D2', 400: '#6993BC',
          500: '#4A77A3', 600: '#3A6089', 700: '#304E6F', 800: '#2A415B', 900: '#25384D', 950: '#172433',
        },
        blue: {
          50: '#F0F4FA', 100: '#DEE6F4', 200: '#BFCEEA', 300: '#95ADDA', 400: '#6B89C6',
          500: '#4D6BB0', 600: '#3D5694', 700: '#334678', 800: '#2C3B62', 900: '#283451', 950: '#192033',
        },
        cyan: {
          50: '#EFF6F7', 100: '#D9EAEC', 200: '#B5D6DA', 300: '#85B9C0', 400: '#5799A2',
          500: '#3D7F89', 600: '#326772', 700: '#2C535C', 800: '#27444C', 900: '#243940', 950: '#142328',
        },
        emerald: {
          50: '#F1F7F3', 100: '#DDEDE3', 200: '#BCDBC8', 300: '#8EC1A4', 400: '#5FA17E',
          500: '#3F8763', 600: '#2F6E50', 700: '#285841', 800: '#224636', 900: '#1D3A2D', 950: '#0F2119',
        },
        green: {
          50: '#F1F7F3', 100: '#DDEDE3', 200: '#BCDBC8', 300: '#8EC1A4', 400: '#5FA17E',
          500: '#3F8763', 600: '#2F6E50', 700: '#285841', 800: '#224636', 900: '#1D3A2D', 950: '#0F2119',
        },
        amber: {
          50: '#FBF6EC', 100: '#F5E9CF', 200: '#EBD39F', 300: '#DDB669', 400: '#CD9A3F',
          500: '#B88124', 600: '#99671A', 700: '#7A5017', 800: '#613F17', 900: '#503416', 950: '#2E1C09',
        },
        rose: {
          50: '#FBF2F2', 100: '#F6E0E0', 200: '#ECC3C4', 300: '#DD9A9D', 400: '#CB6E74',
          500: '#B54B53', 600: '#993A42', 700: '#7D2F37', 800: '#672A31', 900: '#57262C', 950: '#311115',
        },
        red: {
          50: '#FCF3F1', 100: '#F8E1DC', 200: '#F0C2B9', 300: '#E3978A', 400: '#D26B5C',
          500: '#BE4A3B', 600: '#A23A2D', 700: '#842F25', 800: '#6C2921', 900: '#5A251E', 950: '#33110C',
        },
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
        sans: ['"Instrument Sans"', 'system-ui', '-apple-system', 'sans-serif'],
        /** Page titles and salutations - the voice of a letter. Nothing else. */
        display: ['Newsreader', 'Georgia', 'serif'],
        mono: ['JetBrains Mono', 'Consolas', 'monospace'],
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
        'lg': '7px',
        'xl': '10px',
        '2xl': '14px',
        '3xl': '20px',
      },
      transitionDuration: {
        '250': '250ms',
      },
    },
  },
  plugins: [],
};

export default config;
