import React from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
// We need to mock react-three-fiber and the DOM before importing AvatarScene

// Mock for three.js and react-three-fiber
vi.mock('@react-three/fiber', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    Canvas: ({ children, onCreated }) => {
      // simulate onCreated when mounted
      React.useEffect(() => {
        const mockLoseContext = vi.fn();
        const mockGetExtension = vi.fn().mockImplementation((ext) => {
          if (ext === 'WEBGL_lose_context') return { loseContext: mockLoseContext };
          return null;
        });
        
        const mockDomElement = {
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        };

        const mockGl = {
          getExtension: mockGetExtension,
          dispose: vi.fn(),
          domElement: mockDomElement,
        };

        if (onCreated) onCreated({ gl: mockGl });
        
        // This simulates our custom hook in AvatarScene finding gl via useThree
        window.__mockGl = mockGl;
        
      }, [onCreated]);
      return <div data-testid="mock-canvas">{children}</div>;
    },
    useThree: () => {
      return { gl: window.__mockGl || { 
        getExtension: vi.fn(), 
        dispose: vi.fn(), 
        domElement: { addEventListener: vi.fn(), removeEventListener: vi.fn() } 
      }};
    },
    useFrame: () => {}
  };
});

vi.mock('@react-three/drei', () => ({
  ContactShadows: () => <div />,
  Environment: () => <div />,
  OrbitControls: () => <div />,
  useGLTF: () => ({ scene: null }), // returning null scene to avoid deeper rendering issues
}));

// Now import the component
import AvatarSceneWrapper from './AvatarScene';

describe('AvatarScene renderer cleanup', () => {
  it('calls WEBGL_lose_context and gl.dispose() when unmounted', async () => {
    // This is a simplified test simulating the hook behavior. 
    // Since AvatarScene heavily relies on three.js internals, a full integration test is complex.
    // The main logic is in the RendererTelemetry hook inside AvatarScene.jsx.

    // Let's directly test the capability via a controlled render.
    let container = document.createElement("div");
    document.body.appendChild(container);
    
    const { unmount } = render(<AvatarSceneWrapper modelPath="/mock.glb" avatarId="omar" />, { container });

    const mockGl = window.__mockGl;
    expect(mockGl).toBeDefined();
    
    // Grab the mock instance of loseContext
    const extensionMock = mockGl.getExtension('WEBGL_lose_context');
    expect(extensionMock).toBeDefined();

    // Now unmount the component
    unmount();

    // Verify context was explicitly lost and disposed
    expect(extensionMock.loseContext).toHaveBeenCalled();
    expect(mockGl.dispose).toHaveBeenCalled();
    
    container.remove();
  });
});
