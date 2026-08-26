import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'

const databasePath = join(process.cwd(), 'data', 'dhiqar-demo.sqlite')
const database = new DatabaseSync(databasePath)
database.exec('PRAGMA wal_checkpoint(TRUNCATE);')
database.close()
console.log(`Checkpoint complete: ${databasePath}`)
