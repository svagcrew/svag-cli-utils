import child_process from 'child_process'
import fg from 'fast-glob'
import { promises as fs } from 'fs'
import yaml from 'js-yaml'
import _ from 'lodash'
import path from 'path'
import pc from 'picocolors'
import { PackageJson } from 'type-fest'
import { hideBin } from 'yargs/helpers'
import yargs from 'yargs/yargs'
import z from 'zod'

export const getPathsByGlobs = async ({ globs, baseDir }: { globs: string[]; baseDir: string }) => {
  const filePaths = await fg(globs, {
    cwd: baseDir,
    onlyFiles: true,
    absolute: true,
  })
  return { filePaths }
}

export const getDataFromFile = async ({ filePath }: { filePath: string }) => {
  const ext = path.basename(filePath).split('.').pop()
  if (ext === 'js' || ext === 'ts') {
    return require(filePath)
  }
  if (ext === 'yml' || ext === 'yaml') {
    return yaml.load(await fs.readFile(filePath, 'utf8'))
  }
  if (ext === 'json') {
    return JSON.parse(await fs.readFile(filePath, 'utf8'))
  }
  throw new Error(`Unsupported file extension: ${ext}`)
}

export const stringsToLikeArrayString = (paths: string[]) => {
  return paths.map((path) => `"${path}"`).join(', ')
}

export const getPackageJsonPath = async ({ cwd }: { cwd: string }) => {
  let dirPath = path.resolve('/', cwd)
  for (let i = 0; i < 777; i++) {
    const maybePackageJsonGlobs = [`${dirPath}/package.json`]
    const maybePackageJsonPath = (
      await fg(maybePackageJsonGlobs, {
        onlyFiles: true,
        absolute: true,
      })
    )[0]
    if (maybePackageJsonPath) {
      return { packageJsonPath: maybePackageJsonPath }
    }
    const parentDirPath = path.resolve(dirPath, '..')
    if (dirPath === parentDirPath) {
      throw new Error('package.json not found')
    }
    dirPath = parentDirPath
  }
  throw new Error('package.json not found')
}

export const getPackageJsonData = async ({ cwd }: { cwd: string }) => {
  const { packageJsonPath } = await getPackageJsonPath({ cwd })
  const packageJsonData: PackageJson = await getDataFromFile({
    filePath: packageJsonPath,
  })
  return { packageJsonData }
}

export const setPackageJsonData = async ({ cwd, packageJsonData }: { cwd: string; packageJsonData: PackageJson }) => {
  const { packageJsonPath } = await getPackageJsonPath({ cwd })
  await fs.writeFile(packageJsonPath, JSON.stringify(packageJsonData, null, 2))
}

export const getPackageJsonDir = async ({ cwd }: { cwd: string }) => {
  const { packageJsonPath } = await getPackageJsonPath({ cwd })
  return { packageJsonDir: path.dirname(packageJsonPath) }
}

const logColored = ({
  message,
  color,
}: {
  message: string | string[]
  color: 'red' | 'blue' | 'green' | 'gray' | 'black'
}) => {
  const messages = Array.isArray(message) ? message : [message]
  // eslint-disable-next-line no-console
  console.log(pc[color](messages.join('\n')))
}

const logMemory: Record<string, string[]> = {
  default: [],
}
export const logToMemeoryColored = ({
  message,
  color,
  memoryKey = 'default',
}: {
  message: string | string[]
  color: 'red' | 'blue' | 'green' | 'gray' | 'black'
  memoryKey?: string
}) => {
  const messages = (Array.isArray(message) ? message : [message]).map((message) => pc[color](message))
  logMemory[memoryKey] = [...logMemory[memoryKey], ...messages]
}

export const log = {
  it: logColored,
  red: (...message: string[]) => logColored({ message, color: 'red' }),
  blue: (...message: string[]) => logColored({ message, color: 'blue' }),
  green: (...message: string[]) => logColored({ message, color: 'green' }),
  gray: (...message: string[]) => logColored({ message, color: 'gray' }),
  black: (...message: string[]) => logColored({ message, color: 'black' }),
  // eslint-disable-next-line no-console
  error: console.error,
  // eslint-disable-next-line no-console
  info: console.info,
  toMemory: {
    it: logToMemeoryColored,
    red: (...message: string[]) => logToMemeoryColored({ message, color: 'red' }),
    blue: (...message: string[]) => logToMemeoryColored({ message, color: 'blue' }),
    green: (...message: string[]) => logToMemeoryColored({ message, color: 'green' }),
    gray: (...message: string[]) => logToMemeoryColored({ message, color: 'gray' }),
    black: (...message: string[]) => logToMemeoryColored({ message, color: 'black' }),
  },
  fromMemory: (memoryKey = 'default') => {
    for (const message of logMemory[memoryKey] || []) {
      // eslint-disable-next-line no-console
      console.log(message)
    }
  },
  isMemoryNotEmpty: (memoryKey = 'default') => {
    return !!(logMemory[memoryKey]?.length > 0)
  },
}

const normalizeData = <T>(data: T): T => {
  return data
  // const dataString = data.toString()
  // if (dataString.match(/^\n*$/)) {
  //   return ''
  // }
  // return dataString.replace(/\n{2,}/g, '\n')
}

export const exec = async ({
  cwd,
  command,
  verbose = false,
}: {
  cwd: string
  command: string
  verbose?: boolean
}): Promise<string> => {
  return await new Promise((resolve, reject) => {
    if (verbose) {
      log.blue(`$ cd ${cwd}`)
      log.blue(`$ ${command}`)
    }
    child_process.exec(command, { cwd }, (error, stdout, stderr) => {
      if (error) {
        if (verbose) {
          log.error(error)
        }
        return reject(error)
      }
      if (stderr) {
        if (verbose) {
          process.stderr.write(stderr)
          // log.gray(stderr)
        }
        return reject(stderr)
      }
      if (verbose) {
        process.stdout.write(stdout)
        // log.gray(stdout)
      }
      return resolve(stdout)
    })
  })
}

export const spawn = async ({
  cwd,
  command,
  verbose = true,
  env = {},
}: {
  cwd: string
  command: string
  verbose?: boolean
  env?: Record<string, string>
}): Promise<string> => {
  return await new Promise((resolve, reject) => {
    // this not work. becouse one of args can be "string inside string"
    // const [commandSelf, ...commandArgs] = command.split(' ')
    const { commandSelf, commandArgs } = (() => {
      const commandParts = command.match(/(?:[^\s"]+|"[^"]*")+/g)
      if (!commandParts) {
        throw new Error('Invalid command')
      }
      return {
        commandSelf: commandParts[0],
        commandArgs: commandParts.slice(1),
      }
    })()
    if (verbose) {
      log.blue(`$ cd ${cwd}`)
      log.blue(`$ ${command}`)
    }
    const child = child_process.spawn(commandSelf, commandArgs, {
      cwd,
      env: {
        ...process.env,
        ...env,
      },
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (data) => {
      const normalizedData = normalizeData(data)
      if (!normalizedData) {
        return
      }
      stdout += normalizedData
      if (verbose) {
        process.stdout.write(normalizedData)
        // log.gray(normalizedData)
      }
    })
    child.stderr.on('data', (data) => {
      const normalizedData = normalizeData(data)
      if (!normalizedData) {
        return
      }
      stderr += normalizedData
      if (verbose) {
        process.stderr.write(normalizedData)
        // log.gray(normalizedData)
      }
    })
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout)
      } else {
        reject(stderr)
      }
    })
  })
}

export const getCwdCommandArgsFlags = async () => {
  const argv = await yargs(hideBin(process.argv)).argv
  const command = argv._[0]?.toString() || 'help'
  const args = argv._.slice(1).map((arg) => arg.toString())
  const flags = _.omit(argv, ['_', '$0'])
  const cwd = process.cwd()
  return { cwd, command, args, flags }
}

export const validateOrThrow = <T extends z.ZodSchema>(props: { zod: T; text: string; data: any }) => {
  try {
    return props.zod.parse(props.data) as z.infer<T>
  } catch (error) {
    log.red(props.text)
    throw error
  }
}

export const defineCliApp = (app: (props: Awaited<ReturnType<typeof getCwdCommandArgsFlags>>) => any) => {
  void (async () => {
    try {
      const props = await getCwdCommandArgsFlags()
      await app(props)
    } catch (error) {
      log.error(error)
    } finally {
      if (log.isMemoryNotEmpty()) {
        log.green('Result:')
        log.fromMemory()
      }
    }
  })()
}
