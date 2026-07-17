/**
 * @typedef {Object} WeatherLocation
 * @property {string} id
 * @property {string} name
 * @property {string} region
 * @property {number} latitude
 * @property {number} longitude
 * @property {string} timezone
 */

/**
 * @typedef {Object} Weather
 * @property {WeatherLocation} location
 * @property {number} temperature
 * @property {number|null} feelsLike
 * @property {string} condition
 * @property {string} icon
 * @property {number|null} windSpeed
 * @property {number|null} humidity
 * @property {number|null} high
 * @property {number|null} low
 * @property {string} observedAt
 * @property {string} fetchedAt
 */

/**
 * @typedef {"idle"|"loading"|"ready"|"error"} WeatherStatus
 */

/**
 * @typedef {Object} WeatherState
 * @property {WeatherStatus} status
 * @property {Weather|null} data
 * @property {string} error
 * @property {boolean} isRefreshing
 * @property {boolean} isStale
 */

export {};
