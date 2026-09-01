import { formatDuration } from './utils.js'

/**
 * Where the library comes from. Two catalogues, one list: the Zwift workouts the app has always
 * shipped, and the Concept2 archive, which is the only machine-readable rowing corpus there is.
 * Each entry is stamped with the directory it lives under, so a workout knows how to be loaded
 * without the loader having to know which catalogue it came from.
 */
const CATALOGUES = [
  {
    manifest: 'zwift_workouts.json',
    root: 'zwift_workouts_all_collections_ordered_Mar21',
    machine: 'bike'
  },
  { manifest: 'rowing_workouts.json', root: 'rowing_workouts', machine: 'rower' }
]

function stampRoot(node, root, machine) {
  for (const value of Object.values(node)) {
    if (!value || typeof value !== 'object') continue
    if ('url' in value) Object.assign(value, { root, machine })
    else stampRoot(value, root, machine)
  }
  return node
}

/**
 * The library is two catalogues merged, and a cycling session on a rower is not a session at all:
 * its cadence targets are in rpm, and the Concept2 archive is the reverse. Showing both regardless
 * of what is plugged in put eleven hundred bike workouts in front of a rower.
 *
 * Filtering only once a machine is actually connected, rather than defaulting to the bike: before a
 * connection the adapter descriptor is the bike's, so keying off it alone would hide the rowing
 * catalogue from anyone browsing before they connect — which is most of the time.
 */
function keepMachine(node, machine) {
  const kept = {}
  for (const [name, value] of Object.entries(node)) {
    if (!value || typeof value !== 'object') continue
    if ('url' in value) {
      if (value.machine === machine) kept[name] = value
    } else {
      const inner = keepMachine(value, machine)
      if (Object.keys(inner).length) kept[name] = inner
    }
  }
  return kept
}

window.workoutLibraryModal = function () {
  return {
    formatDuration,
    workoutData: {},
    searchQuery: '',
    minDuration: '',
    maxDuration: '',
    filteredData: {},

    async init() {
      await this.loadWorkoutData()
    },

    async loadWorkoutData() {
      try {
        const catalogues = await Promise.all(
          CATALOGUES.map(async ({ manifest, root, machine }) => {
            const response = await fetch(manifest)
            if (!response.ok) throw new Error(`Failed to load ${manifest}`)
            return stampRoot(await response.json(), root, machine)
          })
        )
        this.workoutData = Object.assign({}, ...catalogues)
        this.filteredData = this.workoutData
      } catch (error) {
        console.error('Error loading workout data:', error)
        alert('Could not load the workout library')
      }
    },

    // `ergometerName` and `rowing` come from the app's scope, which this dialog sits inside. Null
    // until something is connected, which is exactly the "show everything" case.
    get machine() {
      if (!this.ergometerName) return null
      return this.rowing ? 'rower' : 'bike'
    },

    get displayData() {
      const data = this.hasActiveFilters ? this.filteredData : this.workoutData
      return this.machine ? keepMachine(data, this.machine) : data
    },

    get hasActiveFilters() {
      return !!(this.searchQuery || this.minDuration || this.maxDuration)
    },

    prepareWorkoutData(item, itemName, collectionName, isSubItem = false) {
      return {
        name: item.name,
        duration: item.duration,
        description: item.description,
        author: item.author,
        showPath: isSubItem && this.hasActiveFilters,
        path: isSubItem ? `${collectionName}/${itemName}` : null,
        onClick: () => {
          this.selectWorkout(item)
        }
      }
    },

    filterData() {
      if (!this.hasActiveFilters) {
        this.filteredData = this.workoutData
        return
      }

      const query = this.searchQuery.toLowerCase()
      const minDuration = this.minDuration ? parseInt(this.minDuration) : 0
      const maxDuration = this.maxDuration
        ? parseInt(this.maxDuration)
        : Infinity

      this.filteredData = this.createFilteredStructure(
        this.workoutData,
        query,
        minDuration,
        maxDuration
      )
    },

    createFilteredStructure(data, query, minDuration, maxDuration) {
      const filtered = {}

      for (const [key, value] of Object.entries(data)) {
        if (this.isWorkoutFile(value)) {
          if (
            this.matchesSearch(value, key, query) &&
            this.matchesDuration(value, minDuration, maxDuration)
          ) {
            filtered[key] = value
          }
        } else if (typeof value === 'object') {
          const filteredCollection = this.createFilteredStructure(
            value,
            query,
            minDuration,
            maxDuration
          )
          if (Object.keys(filteredCollection).length > 0)
            filtered[key] = filteredCollection
        }
      }

      return filtered
    },

    isWorkoutFile(item) {
      return (
        item && typeof item === 'object' && 'name' in item && 'duration' in item
      )
    },

    matchesSearch(item, itemName, query) {
      const searchText = `${item.name} ${item.description || ''} ${
        item.author || ''
      }`.toLowerCase()
      return searchText.includes(query)
    },

    matchesDuration(item, minDuration, maxDuration) {
      return item.duration >= minDuration && item.duration <= maxDuration
    },

    getCollectionCount(collection) {
      return this.countWorkoutsRecursive(collection)
    },

    countWorkoutsRecursive(node) {
      let count = 0
      for (const value of Object.values(node)) {
        if (this.isWorkoutFile(value)) count += 1
        else if (typeof value === 'object')
          count += this.countWorkoutsRecursive(value)
      }
      return count
    },

    async selectWorkout(workoutData) {
      const mainContainer = document.querySelector('[x-data="workoutApp()"]')
      if (!mainContainer || !mainContainer._x_dataStack) {
        console.error('Could not find main Alpine component')
        return
      }
      const mainApp = mainContainer._x_dataStack[0]
      mainApp.selectedWorkout = workoutData
      const success = await mainApp.loadWorkoutFromLibrary(
        workoutData.url,
        workoutData.root
      )
      if (success) this.closeModal()
    },

    closeModal() {
      document.getElementById('libraryModal').close()
    }
  }
}
