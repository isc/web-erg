window.workoutLibraryModal = function () {
  return {
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
        const response = await fetch('zwift_workouts.json')
        if (!response.ok) throw new Error('Failed to load workout data')
        this.workoutData = await response.json()
        this.filteredData = this.workoutData
      } catch (error) {
        console.error('Error loading workout data:', error)
        alert('Erreur lors du chargement de la bibliothèque des entraînements')
      }
    },

    get displayData() {
      return this.hasActiveFilters ? this.filteredData : this.workoutData
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
      const success = await mainApp.loadWorkoutFromLibrary(workoutData.url)
      if (success) this.closeModal()
    },

    closeModal() {
      document.getElementById('libraryModal').close()
    }
  }
}
