/** NOVA's mark: a four-point nova star cut from a solar-orange tile. */
export function NovaMark({ size = 32 }: { size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center rounded-[30%] bg-primary text-primary-foreground"
      style={{ width: size, height: size }}>
      <svg width={size * 0.58} height={size * 0.58} viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M12 1.5c.6 5.6 4.9 9.9 10.5 10.5-5.6.6-9.9 4.9-10.5 10.5C11.4 16.9 7.1 12.6 1.5 12 7.1 11.4 11.4 7.1 12 1.5Z"
          fill="currentColor"
        />
      </svg>
    </span>
  )
}
