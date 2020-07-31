/**
* Since we use a single file named [...params] to aggregate
* all of the configurable options passeed into the url, we have
* to parse the parameters positional based on their position in the
* URL.
*
* The expected URL structire is /{provider}/{org}/{repo}/{ref}/{filepath}.
*/

import React, { FC,  HTMLAttributes, useState, useEffect} from "react";
import { WithRouterProps } from "next/dist/client/with-router";
import { withRouter } from "next/router";
import { Octokit } from "@octokit/rest";

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPlay, faPlus, faSave, faBars, faTerminal, faServer} from '@fortawesome/free-solid-svg-icons'
import { faGithubAlt,  faPython } from '@fortawesome/free-brands-svg-icons'

import Notebook from "@nteract/stateful-components";
import dynamic from "next/dynamic";
import Head from "next/head";
import { Host } from "@mybinder/host-cache";

const CodeMirrorEditor = dynamic(() => import('@nteract/editor'), { ssr: false });

import { Menu, MenuItem } from '../../components/Menu'
import { Button } from '../../components/Button'
import { Console } from '../../components/Console'
import { BinderMenu } from '../../components/BinderMenu'
import { Avatar } from '../../components/Avatar'
import { Input } from '../../components/Input'
import { Dialog, Shadow, DialogRow, DialogFooter } from '../../components/Dialog';
import { FilesListing } from "../../components/FilesListing"
import { Layout, Header, Body, Side, Footer} from "../../components/Layout"

const runIcon =  <FontAwesomeIcon icon={faPlay} />
const saveIcon =  <FontAwesomeIcon icon={faSave} />
const menuIcon =  <FontAwesomeIcon icon={faBars} />
const githubIcon =  <FontAwesomeIcon icon={faGithubAlt} />
const consoleIcon =  <FontAwesomeIcon icon={faTerminal} />
const pythonIcon =  <FontAwesomeIcon icon={faPython} />
const serverIcon =  <FontAwesomeIcon icon={faServer} />
const commitIcon =  <FontAwesomeIcon icon={faPlus} />

const Binder = dynamic(() => import("../../components/Binder"), {
  ssr: false
});

const BINDER_URL = "https://mybinder.org";

/* TODO: Functions like this are or can be used in 
 multiple files, find a way to make them globally available. */
function getPath(params){
    const filepathSegments = params.slice(4);
    let filepath;
    if (typeof filepathSegments !== "string") {
      filepath = filepathSegments.join("");
    } else {
      filepath = filepathSegments;
    }
  
    return filepath
  }

// TODO: Below two functions are identical, they can be one
function useInput(val: string | undefined ){
  const [value, setValue] = useState(val);
  
  function handleChange(e: React.FormEvent<HTMLInputElement> | React.FormEvent<HTMLSelectElement>) {
    setValue(e.currentTarget.value);
  }
  
  return { 
    value, 
    onChange: handleChange
  }
}

function useCheckInput(val: boolean | undefined ){
  const [value, setValue] = useState(val);
  
  function handleChange(e: React.FormEvent<HTMLInputElement>) {
    setValue(e.currentTarget.checked);
  }
  
  return { 
    value, 
    onChange: handleChange
  }
}


function listForks(owner, repo){
   return new Promise(function(resolve, reject) { 
    // This is get the fork of the active repo
    const octo = new Octokit()
     octo.repos.listForks({
         owner: owner,
         repo,
      }).then(({data}) => {
         console.log(data)
         resolve({data})
      }).then((e) => {
         console.log("error")
         console.log(e)
         reject(e)
      })
   });
}

function createFork(octo, owner, repo){
  return new Promise( (resolve, reject) => {
    octo.repos.createFork({
          owner,
          repo,
        }).then(() => {
            console.log("we are about to create fork")
            resolve()
      })
    })
}

const checkFork = (
  octo: Octokit,
  org: string,
  repo: string,
  branch: string = `master`,
  username: string
) => {
  return new Promise( (resolve, reject) => {
  console.log("inside fork")
  // Check if user is owner of the repo
  if( username == org ){
        console.log("user is owner")
        resolve()
  }else{
  // Check if user already have a fork of the repo
  listForks(org, repo).then( ({data}) => {
     console.log("inside listForks")
     console.log(data)
     for (const repo of data){
        console.log("loop")
        if ( repo.owner.login === username){
          console.log(" username is found in list")
          resolve()
        }
     };

      console.log("Fork not found, we need to create fork")
      // Fork the repo
      createFork(octo, org, repo).then( () => {
         console.log("fork created") 
         resolve()
      })

    })
  
  }
 
})
}

/*
 *
 * Save commit to github
 *
 */
const uploadToRepo = async (
    octo: Octokit,
    org: string,
    repo: string,
    branch: string = `master`,
    buffer: {},
) => {
    console.log("inside uploadToRepo")
    const currentCommit = await getCurrentCommit(octo, org, repo, branch)
    console.log(currentCommit)
    // Save only if buffer is not empty
    let pathsForBlobs = []
    let filesContent = []
    for( var key in buffer){
      pathsForBlobs.push(key)
      filesContent.push(buffer[key])
    }
    const filesBlobs = await Promise.all(filesContent.map(createBlobForFile(octo, org, repo)))
    console.log(filesBlobs) 

    //const pathsForBlobs = filesPaths.map(fullPath => path.relative(coursePath, fullPath))
    const newTree = await createNewTree(
          octo,
          org,
          repo,
          filesBlobs,
          pathsForBlobs,
          currentCommit.treeSha
        )
    console.log(newTree)
    const commitMessage = `Auto Commit`
    const newCommit = await createNewCommit(
          octo,
          org,
          repo,
          commitMessage,
          newTree.sha,
          currentCommit.commitSha
        )

     console.log(newCommit)
    await setBranchToCommit(octo, org, repo, branch, newCommit.sha)
}

const getCurrentCommit = async (
    octo: Octokit,
    org: string,
    repo: string,
    branch: string = 'master'
) => {
    const { data: refData } = await octo.git.getRef({
          owner: org,
          repo,
          ref: `heads/${branch}`,
            })
    const commitSha = refData.object.sha
    const { data: commitData } = await octo.git.getCommit({
          owner: org,
          repo,
          commit_sha: commitSha,
        })
    return {
          commitSha,
          treeSha: commitData.tree.sha,
        }
}

// Notice that readFile's utf8 is typed differently from Github's utf-8
//const getFileAsUTF8 = (filePath: string) => readFile(filePath, 'utf8')

const createBlobForFile = (octo: Octokit, org: string, repo: string) => async (
    content: string
) => {
    const blobData = await octo.git.createBlob({
          owner: org,
          repo,
          content,
          encoding: 'utf-8',
        })
    return blobData.data
}

const createNewTree = async (
    octo: Octokit,
    owner: string,
    repo: string,
    blobs: Octokit.GitCreateBlobResponse[],
    paths: string[],
    parentTreeSha: string
) => {
  const tree = blobs.map(({ sha }, index) => ({
        path: paths[index],
        mode: `100644`,
        type: `blob`,
        sha,
      })) as Octokit.GitCreateTreeParamsTree[]
    const { data } = await octo.git.createTree({
          owner,
          repo,
          tree,
          base_tree: parentTreeSha,
        })
    return data
}

const createNewCommit = async (
    octo: Octokit,
    org: string,
    repo: string,
    message: string,
    currentTreeSha: string,
    currentCommitSha: string
) =>
    (await octo.git.createCommit({
          owner: org,
          repo,
          message,
          tree: currentTreeSha,
          parents: [currentCommitSha],
        })).data

const setBranchToCommit = (
    octo: Octokit,
    org: string,
    repo: string,
    branch: string = `master`,
    commitSha: string
) =>
    octo.git.updateRef({
          owner: org,
          repo,
          ref: `heads/${branch}`,
          sha: commitSha,
    })

export interface Props extends HTMLAttributes<HTMLDivElement> {
  router: any
}

export const Main: FC<WithRouterProps> = (props: Props) => {

    const { params } = props.router.query;
    // Toggle Values
    const [ showBinderMenu, setShowBinderMenu ] = useState(false)
    const [ showConsole, setShowConsole ] = useState(false)
    const [ showSaveDialog, setShowSaveDialog ] = useState(false)
   
    // Git API Values
    /* TODO: We need to be able to save multiple files, so this logic 
       won't work. We need to have store for multiple files */
    const [ filepath, setFilepath ] = useState(getPath(params))
    const [ fileContent, setFileContent ] = useState("")
    const [ fileType, setFileType ] = useState("")
    const [ provider, setProvider ] = useState(params[0])
    const [ org, setOrg ] = useState(params[1])
    const [ repo, setRepo ] = useState(params[2])
    const [ gitRef, setGitRef ] = useState(params[3])
  
    // Commit Values
    const commitMessage = useInput("")
    const commitDescription = useInput("")
    // This should be a boolean value but as a string
    const stripOutput = useCheckInput(false)
    const [ fileBuffer, setFileBuffer ] = useState({})
    
    // Login Values
    const [ loggedIn, setLoggedIn ] = useState(false)
    const [ username, setUsername ] = useState("")
    const [ userImage, setUserImage ] = useState("")
    const [ userLink, setUserLink ] = useState("")

/* 
* TODO: Add @nteract/mythic-notifications to file
*/

// This Effect runs only when the username change
useEffect( () => {
  // Check if user has a token saved
  if ( localStorage.getItem("token") != undefined ){
        getGithubUserDetails()
  }
}, [username])

function addBuffer(e){
  setFileContent(e);
  const newFileBuffer = fileBuffer
  newFileBuffer[filepath] = e
  setFileBuffer(newFileBuffer)
}

 function toggle( value, setFunction){
   setFunction(!value)
  }

  function run(){
    console.log("run binder here")
  }

  function showSave(){
    toggle(showSaveDialog, setShowSaveDialog)
  }

  function isNotebook (name: string) {
    return name.includes(".ipynb") 
  }

  function onSave(event){
  event.preventDefault()

    if( Object.keys(fileBuffer).length == 0){
      console.log("No Change or buffer empty")
      return 
    }

   const auth = localStorage.getItem("token") 
   const octo = new Octokit({
     auth
   })
    console.log("inside save")
    console.log("username" + username)
    console.log("org: " + org)
    checkFork( octo, org, repo, gitRef, username).then( () => {
        console.log("inside then")
        setOrg(username)
      uploadToRepo( octo, username, repo, gitRef, fileBuffer).then( () => {
            console.log("saved")
        })
    })

  }

  
  
  // Folder Exploring Function
 async function getFiles( path: string ) {
    const octokit = new Octokit()
    let fileList: string[][] = []
    await octokit.repos.getContents({
      owner: org,
      repo: repo,
      ref: gitRef,
      path
    }).then((res :any) => {
       res.data.map( (item: any) => {
         fileList.push([ item.name, item.path, item.type])
       })
    }, (e: Error) => {
      fileList =  [[""]]
      console.log("Repo Not found")
      console.log(e)
  })

  return fileList

}

 function  loadFile(fileName){
    if( fileName in fileBuffer ) {
      setFileContent(fileBuffer[fileName])
      setFilepath(fileName)
      if ( isNotebook(fileName) )
            setFileType("notebook")
      else
            setFileType("other")

    }else{
    const octokit = new Octokit()
    octokit.repos.getContents({
      owner: org,
      repo: repo,
      path: fileName
    }).then(({data}) => {
        setFileContent( atob(data["content"]) )
        setFilepath(data["path"])
        if ( isNotebook(data["name"]) )
            setFileType("notebook")
        else
            setFileType("other")
    })
    }
  }

  function updateVCSInfo(event, provider, org, repo, gitRef){
    // TODO: Add a loading experience for the users and error if project not found
    event.preventDefault()
    setProvider(provider)
    setOrg(org)
    setRepo(repo)
    setGitRef(gitRef)
  }

 function  oauthGithub(){
   if ( localStorage.getItem("token") == undefined ){
        window.open('https://github.com/login/oauth/authorize?client_id=83370967af4ee7984ea7&scope=repo,read:user&state=23DF32sdGc12e', '_blank');
        window.addEventListener('storage', getGithubUserDetails)
   }  
 }

  function getGithubUserDetails(){
    const token = localStorage.getItem("token") 
        fetch("https://api.github.com/user", {
          method: "GET",
          headers: new Headers({
            "Authorization": "token " + token
          })
          
        })
        .then( (res) => res.json())
        .then( (data) => {
          if( data["login"] !== undefined) {
            setLoggedIn(true)
            setUsername(data["login"])
            setUserLink(data["html_url"])
            setUserImage(data["avatar_url"])
          }else{
            // Login failed | also give notification here
            localStorage.removeItem("token")
          }
        })
    window.removeEventListener("storage", getGithubUserDetails)
  }


    // We won't be following this logic, we will render the data from github and only send changes to binder  
     /*
       <Host repo={`${this.state.org}/${this.state.repo}`} gitRef={this.state.gitRef} binderURL={BINDER_URL}>
         <Host.Consumer>
           {host => <Binder filepath={this.state.filepath} host={host} />}
         </Host.Consumer>
       </Host>
       */

const dialogInputStyle = { width: "98%" }

return (
        <Layout>
          <Head>
             <title>nteract play: Run interactive code</title> 
             <meta charSet="utf-8" />
             <meta name="viewport" content="initial-scale=1.0, width=device-width" />
          </Head>
           {
             showBinderMenu &&
                  
               <BinderMenu
                        provider={provider}
                        org={org}
                        repo={repo}
                        gitRef={gitRef}
                        updateVCSInfo={updateVCSInfo}
                        style={{
                                height: "150px",
                                position: "absolute",
                                marginTop: "49px",
                                width: "calc(100% - 260px)",
                                right: "0px",
                                borderBottom: "1px solid #FBECEC",
                           }}
                        />
           }
        
          { 
            showConsole && <Console style={{ 
                               position: "absolute",
                               bottom: "30px",
                               right: "0px",
                               width: "calc(100% - 260px)"
                 }}>Console</Console> 
          }

        { showSaveDialog &&
          <>
            <Shadow onClick={ ()=> toggle(showSaveDialog, setShowSaveDialog) } />
        <Dialog >
          <form onSubmit={(e) => onSave(e)} > 
          <DialogRow>
                <Input id="commit_message" label="Commit Message" {...commitMessage} autoFocus style={dialogInputStyle} />
          </DialogRow>
          <DialogRow>
              <Input id="commit_description" variant="textarea" label="Description" {...commitDescription} style={dialogInputStyle} />
          </DialogRow>
          <DialogRow>
              <Input id="strip_output" variant="checkbox" label="Strip the notebook output?" checked={stripOutput.value}  onChange={stripOutput.onChange}  style={dialogInputStyle}  />
          </DialogRow>
          <DialogFooter> 
            <Button id="commit_button" text="Commit" icon={commitIcon} />
          </DialogFooter>
          </form>
          </Dialog>
          </>
        }

        <Header>
          <Menu>
              <MenuItem>
                    <Button text="Run" variant="outlined" icon={runIcon} onClick={() => run()}/>
              </MenuItem>
            { loggedIn &&
              <MenuItem>
                    <Button text="Save" variant="outlined" icon={saveIcon} onClick={() => showSave()}/>
              </MenuItem>
            }

              <MenuItem>
                    <Button text="Menu" variant="outlined" icon={menuIcon} onClick={() => toggle( showBinderMenu, setShowBinderMenu)}/>
              </MenuItem>

          </Menu>
            <Menu>
              <MenuItem >
                    { loggedIn
                          ? <Avatar userImage={userImage} username={username} userLink={userLink} / >
                          : <Button onClick={ () => oauthGithub()} text="Connect to Github" icon={githubIcon} />
                    }
                  </MenuItem>
            </Menu>
        </Header>
        <Side>
            <img
              src="https://media.githubusercontent.com/media/nteract/logos/master/nteract_logo_cube_book/exports/images/png/nteract_logo_wide_clear_space_purple.png"
              alt="nteract logo"
              className="logo"
            />
            <FilesListing
                  loadFile={loadFile}
                  loadFolder={getFiles}
                  org={org}
                  repo={repo}
                  gitRef={gitRef} 
          />
        </Side>
        <Body>
          { fileContent != "" &&

          <CodeMirrorEditor
            editorFocused
            completion
            autofocus            
            codeMirror={{
                lineNumbers: true,
                extraKeys: {
                  "Ctrl-Space": "autocomplete",
                  "Ctrl-Enter": () => {},
                          "Cmd-Enter": () => {}
                      },
                cursorBlinkRate: 0,
                mode: "python"
              }}
            preserveScrollPosition
            editorType="codemirror"
            onFocusChange={() => {}}
            focusAbove={() => {}}
            focusBelow={() => {}}
            kernelStatus={"not connected"}
            value={fileContent}
                onChange={(e) => { addBuffer(e)}}
            />

            
                      }
        </Body>

        <Footer>

            <Menu>
                <MenuItem>
                  <Button text="Console" icon={consoleIcon} variant="transparent" onClick={() => toggle(showConsole, setShowConsole)}/>
                </MenuItem>
                <MenuItem>
                      <Button text="Python 3" icon={pythonIcon} variant="transparent" disabled />
                </MenuItem>
                <MenuItem>
                      <Button text="Idle" icon={serverIcon} variant="transparent" disabled/>
                </MenuItem>
            </Menu>
            <Menu>
              <MenuItem>
                Last Saved Never
                </MenuItem>
            </Menu>
        </Footer>
      </Layout>
      );
}

export default withRouter(Main);
