type Props = {
  className?: string;
  width?: number;
  height?: number;
};

export function EinsLogo({ className, width = 600, height = 240 }: Props) {
  const cls = (variant: "light" | "dark") =>
    `eins-logo-${variant}${className ? ` ${className}` : ""}`;
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/eins-logo.svg"
        alt="EINS"
        width={width}
        height={height}
        className={cls("light")}
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/eins-logo-inverted.svg"
        alt="EINS"
        width={width}
        height={height}
        className={cls("dark")}
      />
    </>
  );
}
