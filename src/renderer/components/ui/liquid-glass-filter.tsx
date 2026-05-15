/**
 * GlassFilter — an SVG displacement filter for the "liquid glass" look.
 *
 * Render it once anywhere in the tree, then reference the filter from CSS:
 *   backdrop-filter: url(#bl-glass-displace);
 *
 * It runs fractal noise through a displacement map so whatever shows
 * through the glass surface ripples slightly, like light bent by a thick
 * pane. The host <svg> is display:none — only its <defs> matter.
 */
export function GlassFilter() {
  return (
    <svg className="hidden" aria-hidden="true">
      <defs>
        <filter
          id="bl-glass-displace"
          x="0%"
          y="0%"
          width="100%"
          height="100%"
          colorInterpolationFilters="sRGB"
        >
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.05 0.05"
            numOctaves="1"
            seed="1"
            result="turbulence"
          />
          <feGaussianBlur in="turbulence" stdDeviation="2" result="blurredNoise" />
          <feDisplacementMap
            in="SourceGraphic"
            in2="blurredNoise"
            scale="30"
            xChannelSelector="R"
            yChannelSelector="B"
            result="displaced"
          />
          <feGaussianBlur in="displaced" stdDeviation="2" result="finalBlur" />
          <feComposite in="finalBlur" in2="finalBlur" operator="over" />
        </filter>
      </defs>
    </svg>
  )
}
