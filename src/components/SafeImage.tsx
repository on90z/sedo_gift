import React, { useEffect, useState } from 'react';
import { Flower2 } from 'lucide-react';
import { resolveMediaUrl } from '../lib/api.ts';

interface SafeImageProps {
  src?: string;
  alt: string;
  className?: string;
  aspectClass?: string;
}

export const SafeImage: React.FC<SafeImageProps> = ({
  src,
  alt,
  className = 'w-full h-full object-cover',
  aspectClass = '',
}) => {
  const [failed, setFailed] = useState(false);
  const resolvedSrc = resolveMediaUrl(src);

  useEffect(() => {
    setFailed(false);
  }, [resolvedSrc]);

  if (!resolvedSrc || failed) {
    return (
      <div
        className={`flex flex-col items-center justify-center bg-[#461221] border border-[#944A5E]/60 text-white/75 p-4 ${aspectClass} ${className}`}
        role="img"
        aria-label={alt}
      >
        <Flower2 className="w-8 h-8 opacity-65 mb-2" />
        <span className="text-xs text-white/75 text-center line-clamp-2">{alt}</span>
      </div>
    );
  }

  return (
    <img
      src={resolvedSrc}
      alt={alt}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={className}
      loading="lazy"
    />
  );
};
