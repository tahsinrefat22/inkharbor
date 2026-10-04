import { Image, type ImageProps } from "expo-image";

interface OutlineImageProps extends Omit<ImageProps, "source"> {
  server: string;
  accessToken: string;
  /** An image src from an Outline document, usually /api/attachments.redirect?id=… */
  src: string;
}

/**
 * Shows an image attached to an Outline document. Attachment URLs are relative
 * and need the bearer token. This uses expo-image because React Native's own
 * Image silently drops `source.headers` on Android.
 */
export function OutlineImage({ server, accessToken, src, ...props }: OutlineImageProps) {
  const uri = src.startsWith("/") ? `${server}${src}` : src;
  return (
    <Image
      {...props}
      source={{ uri, headers: { Authorization: `Bearer ${accessToken}` } }}
    />
  );
}
