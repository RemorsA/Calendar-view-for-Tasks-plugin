import { TFile } from 'obsidian';

export interface CreateTaskButtonSettings {
	tasksFolderPath: string;
	createTaskFolderPath: string;
	calendarFolderPath: string;
	language: 'ru' | 'en';
	filenameFormat: string;
	showCompletedTasks: boolean;
	autoOpenCalendar: boolean;
	incompleteTaskColor: string;
	completedTaskColor: string;
	overdueTaskColor: string;
}

export const DEFAULT_SETTINGS: CreateTaskButtonSettings = {
	tasksFolderPath: '',
	createTaskFolderPath: '',
	calendarFolderPath: '',
	language: 'en',
	filenameFormat: 'YYYY-MM',
	showCompletedTasks: true,
	autoOpenCalendar: false,
	incompleteTaskColor: '',
	completedTaskColor: '',
	overdueTaskColor: ''
};

export interface Task {
	text: string;
	date: Date | null;
	file: TFile;
	line: number;
	isCompleted: boolean;
}
