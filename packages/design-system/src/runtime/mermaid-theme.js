// @ts-check
/** @typedef {{background:string,surface:string,text:string,muted:string,line:string,accent:string,accentSoft:string,positive:string,positiveSoft:string,warning:string,warningSoft:string,danger:string,dangerSoft:string,fontFamily:string,dark:boolean}} MermaidPalette */

/** The canonical ecosystem configuration. Callers supply resolved DS token colors as hex. @param {MermaidPalette} p */
export const createMermaidTheme = (p) => ({
  theme: /** @type {const} */ ('base'),
  look: /** @type {const} */ ('classic'),
  startOnLoad: false,
  securityLevel: /** @type {const} */ ('strict'),
  suppressErrorRendering: true,
  htmlLabels: false,
  maxTextSize: 30000,
  maxEdges: 300,
  secure: [
    'secure',
    'securityLevel',
    'startOnLoad',
    'theme',
    'themeVariables',
    'themeCSS',
    'look',
    'htmlLabels',
    'flowchart',
    'layout',
    'sequence',
    'state',
    'class',
    'er',
    'pie',
    'gantt',
    'gitGraph',
    'journey',
  ],
  fontFamily: p.fontFamily,
  flowchart: {
    htmlLabels: false,
    useMaxWidth: false,
    curve: /** @type {const} */ ('rounded'),
    nodeSpacing: 24,
    rankSpacing: 32,
    padding: 12,
    diagramPadding: 12,
    wrappingWidth: 180,
    minNodeWidth: 80,
  },
  sequence: {
    useMaxWidth: false,
    actorMargin: 32,
    actorFontSize: 13,
    noteFontSize: 13,
    messageFontSize: 13,
    width: 120,
    height: 40,
    boxMargin: 8,
    messageMargin: 28,
  },
  themeVariables: {
    darkMode: p.dark,
    background: p.background,
    fontFamily: p.fontFamily,
    fontSize: '13px',
    radius: 12,
    primaryColor: p.accentSoft,
    primaryTextColor: p.text,
    primaryBorderColor: p.accent,
    secondaryColor: p.accentSoft,
    secondaryTextColor: p.text,
    secondaryBorderColor: p.accent,
    tertiaryColor: p.background,
    tertiaryTextColor: p.text,
    tertiaryBorderColor: p.line,
    textColor: p.text,
    lineColor: p.line,
    mainBkg: p.accentSoft,
    nodeBkg: p.accentSoft,
    nodeBorder: p.accent,
    nodeTextColor: p.text,
    clusterBkg: p.surface,
    clusterBorder: p.line,
    titleColor: p.text,
    defaultLinkColor: p.line,
    edgeLabelBackground: p.surface,
    actorBkg: p.accentSoft,
    actorBorder: p.accent,
    actorTextColor: p.text,
    actorLineColor: p.line,
    signalColor: p.line,
    signalTextColor: p.text,
    labelBoxBkgColor: p.surface,
    labelBoxBorderColor: p.line,
    labelTextColor: p.text,
    loopTextColor: p.text,
    activationBkgColor: p.accentSoft,
    activationBorderColor: p.accent,
    sequenceNumberColor: p.text,
    noteBkgColor: p.warningSoft,
    noteBorderColor: p.warning,
    noteTextColor: p.text,
    attributeBackgroundColorOdd: p.surface,
    attributeBackgroundColorEven: p.background,
    classText: p.text,
    relationColor: p.line,
    relationLabelColor: p.text,
    labelColor: p.text,
    altBackground: p.background,
    compositeBackground: p.background,
    compositeBorder: p.line,
    cScale0: p.accentSoft,
    cScale1: p.positiveSoft,
    cScale2: p.warningSoft,
    cScale3: p.dangerSoft,
    cScaleLabel0: p.text,
    cScaleLabel1: p.text,
    cScaleLabel2: p.text,
    cScaleLabel3: p.text,
    pie1: p.accentSoft,
    pie2: p.positiveSoft,
    pie3: p.warningSoft,
    pie4: p.dangerSoft,
    pieStrokeColor: p.line,
    pieOuterStrokeColor: p.line,
    pieSectionTextColor: p.text,
    pieTitleTextColor: p.text,
    pieLegendTextColor: p.text,
    taskBkgColor: p.accentSoft,
    taskBorderColor: p.accent,
    taskTextColor: p.text,
    taskTextOutsideColor: p.text,
    activeTaskBkgColor: p.accentSoft,
    activeTaskBorderColor: p.accent,
    doneTaskBkgColor: p.positiveSoft,
    doneTaskBorderColor: p.positive,
    critBkgColor: p.dangerSoft,
    critBorderColor: p.danger,
    gridColor: p.line,
    todayLineColor: p.accent,
    git0: p.accent,
    git1: p.positive,
    git2: p.warning,
    git3: p.danger,
  },
  themeCSS: `
    text, tspan { font-family: ${p.fontFamily} !important; font-size: 13px !important; }
    text.actor { fill: ${p.text}; stroke: none; }
    .pieTitleText, .titleText { font-size: 16px !important; font-weight: 600; }
    .node rect, .node polygon, .node circle, .node path, .actor, .labelBox { stroke-width: 1.25px; }
    .node rect, rect.actor, rect.note { rx: 12px; ry: 12px; }
    .nodeLabel, .cluster-label { font-weight: 500; }
    .edgePath path, .flowchart-link, .messageLine0, .messageLine1 {
      stroke-width: 1.25px; stroke-linecap: round; stroke-linejoin: round;
    }
    .edgeLabel rect { fill: ${p.surface}; stroke: ${p.line}; stroke-width: .5px; rx: 10px; ry: 10px; opacity: 1; }
    .edgeLabel text { fill: ${p.text}; }
    .cluster rect { rx: 12px; ry: 12px; stroke-width: 1px; }
    .node.kv-accent rect, .node.kv-accent polygon, .node.kv-accent circle, .node.kv-accent path { fill: ${p.accentSoft}; stroke: ${p.accent}; }
    .node.kv-positive rect, .node.kv-positive polygon, .node.kv-positive circle, .node.kv-positive path { fill: ${p.positiveSoft}; stroke: ${p.positive}; }
    .node.kv-warning rect, .node.kv-warning polygon, .node.kv-warning circle, .node.kv-warning path { fill: ${p.warningSoft}; stroke: ${p.warning}; }
    .node.kv-danger rect, .node.kv-danger polygon, .node.kv-danger circle, .node.kv-danger path { fill: ${p.dangerSoft}; stroke: ${p.danger}; }
    .node.kv-decision rect, .node.kv-decision polygon, .node.kv-decision path { fill: ${p.warningSoft}; stroke: ${p.warning}; stroke-dasharray: 3 3; }
  `,
})

/** Resolve light-dark(), aliases and alpha colors through the browser, then flatten to hex. @param {HTMLElement} element */
export const readMermaidPalette = (element) => {
  const probe = element.ownerDocument.createElement('span')
  probe.hidden = true
  element.append(probe)
  /** @param {string} token @param {number[]} [background] */
  const rgb = (token, background = [255, 255, 255]) => {
    probe.style.color = `var(${token})`
    const values = (getComputedStyle(probe).color.match(/[\d.]+/g) ?? []).map(Number)
    const alpha = values[3] ?? 1
    return background.map((base, index) => Math.round((values[index] ?? base) * alpha + base * (1 - alpha)))
  }
  const base = rgb('--kv-panel-bg')
  /** @param {string} token */
  const hex = (token) =>
    `#${rgb(token, base)
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('')}`
  const palette = {
    background: hex('--kv-panel-bg'),
    surface: hex('--kv-panel-bg-subtle'),
    text: hex('--kv-text-main'),
    muted: hex('--kv-text-secondary'),
    line: hex('--kv-text-muted'),
    accent: hex('--kv-color-accent'),
    accentSoft: hex('--kv-color-accent-soft'),
    positive: hex('--kv-positive'),
    positiveSoft: hex('--kv-positive-bg'),
    warning: hex('--kv-warning'),
    warningSoft: hex('--kv-warning-bg'),
    danger: hex('--kv-danger'),
    dangerSoft: hex('--kv-danger-bg'),
    fontFamily: getComputedStyle(element).getPropertyValue('--kv-font-sans').trim(),
    dark: base[0] < 128,
  }
  probe.remove()
  return palette
}

/** Keep content from overriding the ecosystem presentation/security contract. @param {string} source */
export const hasMermaidOverrides = (source) =>
  /^\s*---/u.test(source) || /%%\s*\{|^\s*(?:style|classDef|linkStyle|click)\s/imu.test(source)
