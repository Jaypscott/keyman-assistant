import { DEFAULT_WEATHER_LOCATION } from "../constants/weatherConfig.mjs";
import { createWeatherService } from "../services/weather/weatherService.mjs";

const initialState = Object.freeze({
  status: "idle",
  data: null,
  error: "",
  isRefreshing: false,
  isStale: false,
});

export function createWeatherController({
  service = createWeatherService(),
  location = DEFAULT_WEATHER_LOCATION,
} = {}) {
  let state = initialState;
  let pending = null;
  const subscribers = new Set();

  function getState() {
    return state;
  }

  function subscribe(subscriber) {
    subscribers.add(subscriber);
    return () => subscribers.delete(subscriber);
  }

  async function load() {
    if (pending) return pending;
    const cached = service.readCachedWeather(location);

    if (cached) {
      setState({
        status: "ready",
        data: cached.weather,
        error: "",
        isRefreshing: !cached.isFresh,
        isStale: !cached.isFresh,
      });
      if (cached.isFresh) return cached.weather;
      return runRefresh();
    }

    if (state.status === "ready") return state.data;
    setState({
      status: "loading",
      data: null,
      error: "",
      isRefreshing: false,
      isStale: false,
    });
    return runRefresh();
  }

  function refresh() {
    if (pending) return pending;
    setState({
      status: state.data ? "ready" : "loading",
      data: state.data,
      error: "",
      isRefreshing: Boolean(state.data),
      isStale: Boolean(state.data && state.isStale),
    });
    return runRefresh();
  }

  function runRefresh() {
    pending = service.fetchCurrentWeather(location)
      .then((weather) => {
        setState({
          status: "ready",
          data: weather,
          error: "",
          isRefreshing: false,
          isStale: false,
        });
        return weather;
      })
      .catch((error) => {
        const message = error?.message || "Weather unavailable";
        if (state.data) {
          setState({
            status: "ready",
            data: state.data,
            error: message,
            isRefreshing: false,
            isStale: true,
          });
        } else {
          setState({
            status: "error",
            data: null,
            error: message,
            isRefreshing: false,
            isStale: false,
          });
        }
        return null;
      })
      .finally(() => {
        pending = null;
      });
    return pending;
  }

  function setState(nextState) {
    state = Object.freeze(nextState);
    subscribers.forEach((subscriber) => subscriber(state));
  }

  return {
    getState,
    subscribe,
    load,
    refresh,
  };
}

const defaultController = createWeatherController();

export function useWeather() {
  return defaultController;
}
