import { type ReactNode, useEffect, useRef, useState } from "react";

interface VisibleMediaSlotProps {
  children: ReactNode;
}

export function VisibleMediaSlot({ children }: VisibleMediaSlotProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const element = containerRef.current;

    if (!element || typeof IntersectionObserver === "undefined") {
      setIsVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsVisible(entry?.isIntersecting ?? false);
      },
      {
        rootMargin: "240px 0px"
      }
    );

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, []);

  return <div ref={containerRef}>{isVisible ? children : null}</div>;
}
