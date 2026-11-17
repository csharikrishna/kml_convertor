import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CAD2KML Pro · Modern GIS Workstation",
  description:
    "Convert AutoCAD DXF and DWG engineering drawings to Google Earth KML/KMZ with high-precision geodesic GIS rendering, UTM conversion, layer controls, and High-DPI PDF export.",
  icons: {
    icon: "/favicon.ico",
    apple: "/favicon-192.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link
          rel="stylesheet"
          href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
          integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY="
          crossOrigin=""
        />
      </head>
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased selection:bg-blue-100 selection:text-blue-900">
        {children}
      </body>
    </html>
  );
}
