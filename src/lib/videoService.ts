import { Video } from "@/types/video";

class VideoService {
  private baseUrl = "/api/videos";

  async getVideoByOrder(order: number): Promise<Video | null> {
    try {
      const response = await fetch(`${this.baseUrl}/${order}`);

      if (!response.ok) {
        if (response.status === 404) {
          return null;
        }
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error("Error fetching video by order:", error);
      throw error;
    }
  }

  async getVideos(limit?: number): Promise<Video[]> {
    try {
      const url = limit ? `${this.baseUrl}?limit=${limit}` : this.baseUrl;

      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error("Error fetching videos:", error);
      throw error;
    }
  }
}

export const videoService = new VideoService();
