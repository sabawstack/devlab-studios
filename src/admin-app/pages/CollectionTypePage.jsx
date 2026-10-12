import { useParams } from 'react-router-dom'
import { REPLACE_ALL_REGISTRY, PER_ITEM_REGISTRY } from '../lib/fieldDescriptors'
import ReplaceAllCollectionPage from './ReplaceAllCollectionPage'
import PerItemCollectionPage from './PerItemCollectionPage'

function CollectionTypePage() {
  const { type } = useParams()

  // Keyed by type so switching collections remounts with fresh state; reusing
  // the instance showed (and could save) the previous collection's items
  // while the next one loaded.
  if (REPLACE_ALL_REGISTRY[type]) return <ReplaceAllCollectionPage key={type} />
  if (PER_ITEM_REGISTRY[type]) return <PerItemCollectionPage />

  return <p className="text-rose-600">Unknown collection type: {type}</p>
}

export default CollectionTypePage
