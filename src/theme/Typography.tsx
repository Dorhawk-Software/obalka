// Text role components - the typography "visual library". Each bakes in a role's size/weight/
// line-height (from `typography.ts`) plus an AA-contrast default color, so screens compose legible,
// consistent text without repeating fontSize/color. Any prop (color, numberOfLines, flex, margins…)
// can still be overridden inline; overriding `fontSize` rescales the line box with it. Pass `dense` for
// the design's tight single-line list rows. Built on the themed `Text` primitive.

import { Text } from './ui';
import { useTheme } from './ThemeProvider';
import type { Theme } from './theme';
import {
  fonts,
  metricLeading,
  type as typeScale,
  type TextRole,
} from './typography';

// ui.Text is the Tamagui Text (typed `any` via the shim); role props are therefore passthrough.
type RoleProps = Record<string, unknown>;
type Weight = '400' | '500' | '600' | '700' | '800';

/**
 * Resolve the actual FONT FILE for an effective weight. Public Sans / Bricolage ship as 4-style
 * families - each weight is a SEPARATE face - so RN cannot reach a sibling weight via `family +
 * fontWeight` (Android ignores the weight, iOS keeps the named face). A `fontWeight` override on a role
 * component must therefore switch the face too, or it silently renders at the base face's weight (the
 * "all weights look identical" bug). Bricolage is bundled at 600/700/800; Public Sans at 400/500/600/
 * 700/800. An unavailable weight falls to the nearest bundled face.
 */
function faceForWeight(baseFamily: string, weight: Weight): string {
  if (baseFamily.startsWith('Bricolage')) {
    if (weight === '800') {
      return fonts.displayXBold;
    }
    if (weight === '600' || weight === '500' || weight === '400') {
      return fonts.displaySemiBold;
    }
    return fonts.displayBold; // 700
  }
  switch (weight) {
    case '800':
      return fonts.bodyXBold;
    case '700':
      return fonts.bodyBold;
    case '600':
      return fonts.bodySemiBold;
    case '500':
      return fonts.bodyMedium;
    default:
      return fonts.bodyRegular; // 400
  }
}

function roleComponent(role: TextRole, colorKey: keyof Theme) {
  const s = typeScale[role];
  return function RoleText(props: RoleProps) {
    const theme = useTheme();
    // The effective weight is the caller's override or the role default; from it we pick the actual
    // FACE. We then render with ONLY `fontFamily` (the resolved face) and pass NO `fontWeight`.
    // Reason: these are 4-style families (Medium/SemiBold/ExtraBold are each a separate iOS family),
    // and passing a `fontWeight` alongside a specific face makes iOS re-derive from the base family
    // and mis-render the non-Regular/Bold weights (the subject rendered as heavy as the sender on
    // iPhone). Android renders the named face regardless of weight, so dropping it changes nothing
    // there. `fontWeight` is destructured out so a caller's override can't leak back onto the Text.
    const {
      fontWeight,
      fontFamily,
      dense,
      fontSize: fontSizeProp,
      lineHeight: lineHeightProp,
      ...rest
    } = props;
    const weight = (fontWeight as Weight | undefined) ?? s.fontWeight;
    const family =
      (fontFamily as string | undefined) ?? faceForWeight(s.fontFamily, weight);

    // The LINE BOX has to follow the font size. A caller that overrode only `fontSize` used to keep the
    // role's line-height - a box sized for a DIFFERENT size - so 14px text sat in the 21px box meant for
    // 15px and every such row rendered taller than the design. The leading is therefore derived: the
    // role's own ratio normally, or the family's tight METRIC leading when `dense` (what the design's
    // list rows get, since they set no line-height). An explicit `lineHeight` still wins outright.
    const fontSize = (fontSizeProp as number | undefined) ?? s.fontSize;
    const leading = dense
      ? metricLeading[s.fontFamily.startsWith('Bricolage') ? 'display' : 'body']
      : s.lineHeight / s.fontSize;
    const lineHeight =
      (lineHeightProp as number | undefined) ?? Math.round(fontSize * leading);

    return (
      <Text
        fontSize={fontSize}
        lineHeight={lineHeight}
        letterSpacing={s.letterSpacing}
        color={theme[colorKey]}
        {...rest}
        fontFamily={family}
      />
    );
  };
}

/** Main screen title (home). */
export const Display = roleComponent('display', 'text');
/** Stack-header titles, dialog titles, a message subject. */
export const Title = roleComponent('title', 'text');
/** Section headers, a box owner's name. */
export const Heading = roleComponent('heading', 'text');
/** Primary readable text. */
export const Body = roleComponent('body', 'text');
/** Emphasized body text. */
export const BodyStrong = roleComponent('bodyStrong', 'text');
/** The value paired with a label (box id, login name). */
export const Value = roleComponent('value', 'text');
/** Form / metadata field labels. */
export const Label = roleComponent('label', 'textMuted');
/** Metadata, timestamps, helper text. */
export const Caption = roleComponent('caption', 'textMuted');
/** Pill text - color is usually set by the pill. */
export const Badge = roleComponent('badge', 'text');
