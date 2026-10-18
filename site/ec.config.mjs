// Code blocks in Caret's Neutral palette (caretui.rashmitaparmanik.com): keywords in heavy ink,
// strings in success green, numbers in danger red, comments in faint italic, the rest in ink-2.
// Frame chrome reads the site's --cf-* tokens from src/styles/custom.css.
import { defineEcConfig, ExpressiveCodeTheme } from '@astrojs/starlight/expressive-code';

/** A TextMate theme from Caret role colors. */
const theme = (name, type, c) =>
  new ExpressiveCodeTheme({
    name,
    type,
    colors: {
      'editor.background': c.page,
      'editor.foreground': c.ink2,
      'editor.selectionBackground': c.selection,
      'editorLineNumber.foreground': c.ink3,
    },
    tokenColors: [
      { settings: { foreground: c.ink2 } },
      {
        scope: ['comment', 'punctuation.definition.comment'],
        settings: { foreground: c.ink3, fontStyle: 'italic' },
      },
      {
        scope: [
          'keyword',
          'storage',
          'storage.type',
          'storage.modifier',
          'variable.language',
          'keyword.operator.new',
        ],
        settings: { foreground: c.ink, fontStyle: 'bold' },
      },
      {
        scope: ['keyword.operator', 'punctuation', 'meta.brace'],
        settings: { foreground: c.ink3, fontStyle: '' },
      },
      {
        scope: ['string', 'punctuation.definition.string', 'string.template'],
        settings: { foreground: c.success },
      },
      {
        scope: ['constant.numeric', 'constant.language', 'support.constant'],
        settings: { foreground: c.danger },
      },
      {
        scope: ['entity.name.function', 'support.function', 'entity.name.type', 'support.type'],
        settings: { foreground: c.ink },
      },
      { scope: ['support.type.property-name', 'meta.object-literal.key'], settings: { foreground: c.ink2 } },
      {
        scope: ['markup.heading', 'entity.name.section'],
        settings: { foreground: c.ink, fontStyle: 'bold' },
      },
    ],
  });

export default defineEcConfig({
  themes: [
    // Hex values are Caret's OKLCH tokens, converted once.
    theme('caret-dark', 'dark', {
      page: '#161510', // oklch(19.5% .01 95)
      ink: '#edf0f5', // oklch(95.5% .007 260)
      ink2: '#bbc1c9', // oklch(80.8% .013 260)
      ink3: '#9ca0a7', // oklch(70.6% .011 260)
      success: '#3ab260', // oklch(67.9% .16 150)
      danger: '#f57569', // oklch(71% .16 27)
      selection: '#3f2900', // oklch(30% .063 78)
    }),
    theme('caret-light', 'light', {
      page: '#f5f4ef', // oklch(96.6% .006 95)
      ink: '#15181f', // oklch(21% .014 260)
      ink2: '#42464d', // oklch(39.4% .013 260)
      ink3: '#5f6369', // oklch(49.8% .011 260)
      success: '#007936', // oklch(50.5% .139 150)
      danger: '#b93e37', // oklch(53.9% .16 27)
      selection: '#fee8c6', // oklch(94% .05 78)
    }),
  ],
  styleOverrides: {
    borderRadius: '12px',
    borderColor: 'var(--cf-line)',
    codeFontFamily: 'var(--cf-font-mono)',
    codeFontSize: '0.78125rem',
    codeLineHeight: '1.375rem',
    codePaddingBlock: '0.75rem',
    codePaddingInline: '1rem',
    uiFontFamily: 'var(--cf-font-ui)',
    uiFontSize: '0.8125rem',
    uiFontWeight: '550',
    focusBorder: 'var(--cf-focus)',
    frames: {
      frameBoxShadowCssValue: 'none',
      editorTabBarBackground: 'var(--cf-surface)',
      editorTabBarBorderBottomColor: 'var(--cf-line)',
      editorActiveTabBackground: 'var(--cf-surface)',
      editorActiveTabForeground: 'var(--cf-ink-2)',
      editorActiveTabBorderColor: 'transparent',
      editorActiveTabIndicatorTopColor: 'transparent',
      editorActiveTabIndicatorBottomColor: 'var(--cf-accent-strong)',
      editorActiveTabIndicatorHeight: '2px',
      terminalTitlebarBackground: 'var(--cf-surface)',
      terminalTitlebarForeground: 'var(--cf-ink-3)',
      terminalTitlebarBorderBottomColor: 'var(--cf-line)',
      terminalTitlebarDotsOpacity: '0',
      inlineButtonBackground: 'var(--cf-surface)',
      inlineButtonForeground: 'var(--cf-ink-2)',
      inlineButtonBorder: 'var(--cf-line-strong)',
      tooltipSuccessBackground: 'var(--cf-ink)',
      tooltipSuccessForeground: 'var(--cf-on-ink)',
    },
  },
});
