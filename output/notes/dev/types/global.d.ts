declare module "ninja-keys";

declare global {
  interface Window {
    sourcePath?: string;
  }

  interface NinjaKeysElement extends HTMLElement {
    data: Array<{
      id: string;
      title: string;
      section: string;
      hotkey?: string;
      icon?: string;
      handler: () => void;
    }>;
  }
}

export {};
