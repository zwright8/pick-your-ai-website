import { Link } from 'react-router';
import { useContext } from 'react';
import { DataContext } from '../../app/data-context';
import { PartsHead } from '../../components/PartsHead';
import { Loading } from '../../components/feedback';

export function builderDescription(mode: 'fixture' | 'http' | undefined): string {
  return mode === 'fixture'
    ? 'One row per component slot, in dependency order. Prices and compatibility come from synthetic demo data; nothing here is a quote or a vendor specification.'
    : 'One row per component slot, in dependency order. Prices are estimates and compatibility depends on recorded evidence; nothing here is a quote or a vendor specification.';
}

/** Keep the page identity visible while either editor code or build data loads. */
export function BuilderLoading() {
  const mode = useContext(DataContext)?.mode;
  return (
    <div className="app-page parts-page">
      <div className="container">
        <PartsHead
          crumbs={
            <>
              <Link to="/">PickYour.AI</Link> <span>/</span> Builder
            </>
          }
          title="Choose your parts"
          description={builderDescription(mode)}
        />
        <Loading label="Loading the parts register…" />
      </div>
    </div>
  );
}
