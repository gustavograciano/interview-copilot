import React, { useEffect, useState } from 'react';
import { Overlay } from './Overlay';
import { Settings } from './Settings';
import { Coding } from './Coding';

function getRoute() {
  return window.location.hash.replace(/^#/, '') || '/overlay';
}

export function App() {
  const [route, setRoute] = useState(getRoute());

  useEffect(() => {
    const onHash = () => setRoute(getRoute());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  if (route === '/settings') return <Settings />;
  if (route === '/coding') return <Coding />;
  return <Overlay />;
}
